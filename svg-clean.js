function SVGClean(params) {
  var SVGC = new Object();
  SVGC.data = new Object();


  //////////////////////////////
  // PUBLIC METHODS
  //////////////////////////////

  SVGC.clean = function($svg) {
    // convert svg to json
    SVGC.source = SVGToJSON($svg, {
      stats: true
    });
    SVGC.svg_clean = new Object();

    // initial cleaned object is json array
    var $cleaned = SVGC.source.json;
    // consolidate gradients
    if(params.consolidate_gradients) {
      SVGC.Gradients($cleaned).then(function(res) {
        $cleaned = res;
        console.debug('SVGC.Gradients',$cleaned);
        return $cleaned;
      });
    }

  }



  //////////////////////////////
  // MODULES
  //////////////////////////////

  //
  // Gradients
  // consolidate gradients into defs, remove duplicates with xlink:href
  //

  SVGC.Gradients = function($svg_json) {

    return new Promise(function(resolveGradients, rejectGradients) {

      // add gradient data
      SVGC.data.gradients = new Object();

      // finding all gradients
      var findGradients = function() {
        return new Promise(function(resolve, reject) {
          resolve(findGradientsInJSON($svg_json));
        });
      };

      // promise found gradients
      findGradients().then(function(res) {
        SVGC.data.gradients.found = res;
        // console.debug('findGradients():',res);

        // consolidate gradients by clearing redundancy
        var consolidateGradients = function() {
          return new Promise(function(resolve, reject) {
            resolve(consolidateFoundGradients(SVGC.data.gradients.found));
          });
        };

        // promise consolidated gradients
        consolidateGradients().then(function(res) {
          SVGC.data.gradients.consolidated = res;
          // console.debug('consolidateGradients():',res);

          // reorganize svg with consolidated gradients
          var reorganizeSource = function() {
            return new Promise(function(resolve, reject) {
              resolve(reorganizeSVGWithConsolidatedGradients(SVGC.data.gradients.consolidated, $svg_json));
            });
          };

          // promise reorganized source
          reorganizeSource().then(function(res) {
            // console.debug('reorganizeSource():',res);
            resolveGradients(res);

          }).catch(function(err) {
            console.error('reorganizeSource():', err);
            rejectGradients(err);
          });

        }).catch(function(err) {
          console.error('consolidateGradients():', err);
          rejectGradients(err);
        });

      }).catch(function(err) {
        console.error('findGradients():', err);
        rejectGradients(err);
      });

    });


    //
    // find gradients in svg json
    function findGradientsInJSON(svg_json) {

      var gradients = new Array();

      // for each tag
      for(var i = 0; i < svg_json.length; i++) {
        var el = svg_json[i];

        // if a gradient
        if(el.name.match(/Gradient/)) {
          // handle types of gradient tags
          switch(el.type) {

            // open tags find all containing stops to create gradient
            case 'open':
              var $gradient = {
                type: 'full',
                position: i,
                name: el.name,
                attrs: el.attrs,
                stops: new Array(),
                stops_str: "",
                stop_count: 0
              };

              var finding_stops = true;

              while(finding_stops) {
                i++;
                var stop = svg_json[i];
                if(stop.name != 'stop') {
                  finding_stops = false;
                } else {
                  $gradient.stop_count++;
                  $gradient.stops.push(stop.attrs);
                  $gradient.stops_str += JSON.stringify(stop.attrs).replace(/[{}\"\',:]/g,'');
                }
              }
              gradients.push($gradient);
              break;


            case 'closeself':
              var $gradient = {
                type: 'ref',
                position: i,
                stop_count: 0,
                name: el.name,
                attrs: el.attrs
              };
              gradients.push($gradient);
              break;
          }

        }

      }

      return gradients;

    }


    //
    // take existing gradients,
    // return consolidated gradients (duplicates in xlinks)
    function consolidateFoundGradients(found_gradients) {
      var consolidated_gradients = new Array();

      // if any gradients exist
      if(found_gradients) {

        // for each match
        for (var match = 0; match < found_gradients.length; match++) {

          // store the current gradient
          var gradient = found_gradients[match];

          //
          // if we're past the first match, we need to start looking for duplicate stops and xlink them
          if (match > 0 && gradient.stops && gradient.stops.length) {
            // checking flag
            var checking = true;

            // see if stops match a previous stops
            for (var s = match; s > 0; s--) {

              // if stops match previous stops
              if (gradient.stops_str == found_gradients[s - 1].stops_str && checking) {
                checking = false;

                // remove stops value
                gradient.stops = null;
                gradient.stops_str = '';

                // gradient type is now a ref
                gradient.type = 'ref';

                // ref id
                var ref_id = found_gradients[s - 1].attrs.id;

                // add xlink attribute
                gradient.attrs['xlink:href'] = '#' + ref_id;

                // sort by is ref id
                gradient.sort_by = ref_id  + "-lvl-2";

              } else {

                // sort by is id
                gradient.sort_by = gradient.attrs.id + "-lvl-1";

              }
            }
          } else {

            // first match or no stops
            if(gradient.attrs['xlink:href']) {
              // sort by is xlink
              gradient.sort_by = gradient.attrs['xlink:href'].replace(/#/,'') + "-lvl-2";
              // no stops
              gradient.stops = null;
              gradient.stops_str = '';
            } else {
              // sort by is id
              gradient.sort_by = gradient.attrs.id + "-lvl-1";
            }

          }

          //
          // add gradient to consolidated_gradients
          consolidated_gradients.push(gradient);

        }

        return consolidated_gradients;

      } else {
        return found_gradients;
      }

    }


    //
    // take source svg json and consolidated gradients,
    // and return updated source with gradients in defs
    function reorganizeSVGWithConsolidatedGradients(consolidated_gradients, source) {
      //
      // loop through gradients and clean up source
      var svg = new Array(),
          // tmp clone of source for manipulation
          svg_src_tmp = source.slice(0);


      //
      // for each gradient, remove from svg source
      var relative_index = 0;
      for(var g = 0; g < consolidated_gradients.length; g++) {
        // grabbing the gradient
        var gradient = consolidated_gradients[g],
            // how many items we are going to remove from array (stops, closing tags included)
            remove_amount = (gradient.stop_count > 0) ? gradient.stop_count + 2 : 1;
        // remove items from array
        svg_src_tmp.splice(gradient.position - relative_index, remove_amount);
        // adjust the relative index since we just removed a bunch of shit
        relative_index += remove_amount;
      }


      //
      // sort gradients by sort_by property
      consolidated_gradients.sort(function(a, b) {
          if (a.sort_by < b.sort_by)
            return -1;
          if (a.sort_by > b.sort_by)
            return 1;
          return 0;
      });


      //
      // detect defs. if exist, do nothing. else create.
      var defs_index = null,
          defs_inc = 0;

      // look for defs index
      while(!defs_index) {
        // if it is a def
        if(source[defs_inc].name == 'defs') defs_index = defs_inc + 1;
        // if we havent hit the end
        if(defs_inc < source.length - 1) {
          // go to next item
          defs_inc++;
        } else {
          // no defs found, we need to inject a defs element
          svg_src_tmp.splice(1, 0, {
            attrs: {}, name: 'defs', pos: 1, type: 'open',
          }, {
            attrs: {}, name: 'defs', pos: 1, type: 'close',
          });
          // and set the defs index
          defs_index = 2;
        }
      }

      //
      // reinject gradients into tmp src
      for(var g = 0; g < consolidated_gradients.length; g++) {
        var gradient = consolidated_gradients[g];

        // inject the gradient open tag
        inject({
          name: gradient.name,
          type: (gradient.type == 'ref') ? 'closeself' : 'open',
          pos: 2,
          attrs: gradient.attrs
        });

        // inject the gradient stops and close tag
        if(gradient.type != 'ref') {
          if(gradient.stops) {
            for(var i = 0; i < gradient.stops.length; i++) {
              var stop = gradient.stops[i];
              // inject the closing tag
              inject({
                name: 'stop',
                type: 'closeself',
                pos: 3,
                attrs: stop
              });
            }
          }

          // inject the closing tag
          inject({
            name: gradient.name,
            type: 'close',
            pos: 2,
            attrs: gradient.attrs
          });
        }
      }

      function inject(obj) {
        svg_src_tmp.splice(defs_index++, 0, obj);
      }


      return svg_src_tmp;

    }



  }




  //////////////////////////////
  // MODULE METHODS
  //////////////////////////////




  return SVGC;
}






//////////////////////////////
// MODULES
//////////////////////////////







//
// take string of svg and return json

function SVGToJSON($svg, opts) {

  //
  // //
  var $svg_json = new Object(),
      // get the regex library for matches
      _lib = new RegexLibrary();

  //
  // convert svg tags to objects
  $svg_json.json = getTagObjects();
  if(opts && opts.stats) $svg_json.stats = getTagStats();


  //
  // return the loveliness
  // an array for now.
  // maybe build out as an object model later.
  // not necessary.
  return $svg_json;


  //
  // convert svg tags to objects
  function getTagObjects() {
    // remove whitespace from the svg
    $svg = $svg.replace(_lib.__remove_whitespace, '');
    // find instances of content
    contents = $svg.match(_lib.__tag_content);
    // make sure their quotes are escaped
    for(var c = 0; c < contents.length; c++) {
      var clean = contents[c].replace(/"/g,'&quot;');
      var exp = new RegExp(contents[c]);
      $svg = $svg.replace(exp,clean);
    }
    // move content (text content, etc) to attribute
    $svg = $svg.replace(_lib.__tag_content, '_content="$1"><');
    // get array of all tags in svg
    var tags = $svg.match(_lib.__tag),
        arr = new Array();
    // for each tag, create object
    for(var t = 0; t < tags.length; t++) {
      var tag = tags[t],
          obj = {
            name: getTagName(tag),
            type: getTagType(tag),
            pos: undefined,
            attrs: getTagAttributes(tag)
          };
      arr.push(obj);
    }

    //
    // for each object, set a tab position
    var position = 0;
    for(var o = 0; o < arr.length; o++) {
      var object = arr[o];
      // decrease if closing tag
      if(object.type === 'close') position--;
      // position determined by previous
      object.pos = position;
      // increase if open tag
      if(object.type === 'open') position++;
    }

    //
    // return the array
    return arr;
  }


  //
  // get a tag's type (open, close, self-close)
  function getTagType(tag) {
    if(tag.match(_lib.__opening)) {
      return 'open';
    } else if(tag.match(_lib.__closing)) {
      return 'close';
    } else if(tag.match(_lib.__self_closing)) {
      return 'closeself';
    } else {
      return 'undefined';
    }
  }


  //
  // get a tag's name
  function getTagName(tag) {
    return tag.match(_lib.__tagname)[0];
  }


  //
  // get a tag's attributes
  function getTagAttributes(tag) {
    var rawattrs = tag.match(_lib.__tagattrs) || new Array(),
        attrs = new Object();
    // for each attribute in tag
    for(var a = 0; a < rawattrs.length; a++) {
      var attr = rawattrs[a],
          key = attr.match(_lib.__attr_key)[0],
          key_exp = new RegExp(key,''),
          val = attr.replace(key_exp, '').replace(/[="']/g, ''),
          attr_obj = new Object();
      attrs[key] = val;
    }
    return attrs;
  }


  //
  // get stats for generated JSON
  function getTagStats() {
    var stats = {
      elements: new Object(),
      attributes: new Object()
    };
    for(var i = 0; i < $svg_json.json.length; i++) {
      var obj = $svg_json.json[i];
      if(obj.type != 'close') {
        // count tag name
        if(stats.elements[obj.name]) { stats.elements[obj.name]++; }
        else { stats.elements[obj.name] = 1; }

        // count attributes
        for(var k in obj.attrs) {
          if(stats.attributes[k]) { stats.attributes[k]++; }
          else { stats.attributes[k] = 1; }
        }
      }
    }
    return stats;
  }


  //
  // regex library
  function RegexLibrary() {
    return {
      // remove whitespace
      __remove_whitespace: /(  )|\t|\n/g,
      // getting any tag
      __tag: /<.+?>/g,
      // get content
      __tag_content: />([^$<]+)</g,
      // when quotes in attributes
      __tag_content_attribute_quotes: /_content="(([^"]+)(")([^"]+)(")([^"]+)?)*">/g,
      // opening tag
      __opening: /<[^\/]>|<[^\/]((?!\/>)[\s\S])+?[^\/]>/,
      // closing tag
      __closing: /<\/[^\/]+?>/,
      // self closing tag
      __self_closing: /<[^\/<]+?\/>/,
      // tag name
      __tagname: /[^< \/>]+/,
      // getting each attribute
      __tagattrs: /[a-zA-Z0-9-:_]+=["']?(([^"']+["'\/])|([^"' \/>]+))/g,
      // getting each attribute key
      __attr_key: /[^ =]+/
      // getting each attribute value by replacing key
    }
  }

}
/*
 * Online handwriting recognition for Japanese, ported from Kanji Canvas.
 *
 *   Kanji Canvas -- https://github.com/asdfjkl/kanjicanvas
 *   Copyright (c) 2019-2024 Dominik Klein
 *   Copyright (c) 2020 Seth Clydesdale
 *   Licensed under the MIT licence; see LICENSES.md.
 *
 * The MIT terms require the copyright notice above to be kept, and the project
 * asks that the backlink be kept with it. Both stay.
 *
 * The reference patterns this matches against derive from KanjiVG,
 * (c) Ulrich Apel, CC BY-SA 3.0.
 *
 * ## What changed in the port
 *
 * The algorithm is unmodified -- the numbers it produces are the originals',
 * which is the whole reason for porting rather than reimplementing. What
 * changed is everything around it:
 *
 *   - The two entry points took the id of a canvas element and read the strokes
 *     off a global keyed by that id. They now take the strokes.
 *   - `refPatterns` was a module-level global holding every character at once.
 *     It is an argument now, because this app loads one JLPT level at a time
 *     rather than six thousand characters up front.
 *   - `fineClassification` built an HTML string and wrote it into an element by
 *     id. It returns an array of characters.
 *   - The drawing, undo and canvas functions are gone; React does that here.
 *     See `HandwritingInput.tsx`.
 *
 * Kept as plain JavaScript with a hand-written `.d.ts` beside it, so that
 * `scripts/build-strokes.mjs` and the app share one implementation -- the build
 * needs `momentNormalize` and `extractFeatures` to convert the kana, and a
 * second copy of those would be a second copy that drifts.
 *
 * A note on the style: this is 2019-vintage JavaScript, with `var`, index loops
 * and irregular indentation, and it is left that way on purpose. Modernising it
 * would mean editing every line of a numerical routine that currently produces
 * known-correct output, for no behavioural gain. `pipeline.test.js` checks the
 * port against the upstream data precisely because that output is what is worth
 * protecting.
 */

/*
 * Scratch variables that were properties of the `KanjiCanvas` namespace object.
 *
 * The original leaned on that object for working state, which module scope does
 * not provide -- and unlike a plain script, an ES module is strict, so the bare
 * assignments left by the port would throw rather than quietly creating
 * globals. Declared here so the arithmetic below is untouched.
 *
 * They are written and read within a single synchronous call, so sharing them
 * across calls is safe in the only sense that matters here: nothing awaits
 * between a write and its read.
 */
var newHeight, newWidth, oldHeight, oldWidth;
var xMin, xMax, yMin, yMax, xNorm, yNorm, x, y;
var dii, j_of_i, minDist, min_j;

function normalizeLinear(pattern) {

    var normalizedPattern = new Array();
    newHeight = 256;
    newWidth = 256;
    xMin = 256;
    xMax = 0;
    yMin = 256;
    yMax = 0;
    // first determine drawn character width / length
    for(var i = 0;i<pattern.length;i++) {
      var stroke_i = pattern[i];
      for(var j = 0; j<stroke_i.length;j++) {
        x = stroke_i[j][0];
        y = stroke_i[j][1];
        if(x < xMin) {
          xMin = x;
        }
        if(x > xMax) {
          xMax = x;
        }
        if(y < yMin) {
          yMin = y;
        }
        if(y > yMax) {
          yMax = y;
        }
      }
    }	
    oldHeight = Math.abs(yMax - yMin);
    oldWidth  = Math.abs(xMax - xMin);

    for(var i = 0;i<pattern.length;i++) {
      var stroke_i = pattern[i];
      var normalized_stroke_i = new Array();
      for(var j = 0; j<stroke_i.length;j++) {
        x = stroke_i[j][0];
        y = stroke_i[j][1];
        xNorm = (x - xMin) * (newWidth / oldWidth) ;
        yNorm= (y - yMin) * (newHeight / oldHeight);
        normalized_stroke_i.push([xNorm, yNorm]);
      }
      normalizedPattern.push(normalized_stroke_i);
    }
    return normalizedPattern;
    redraw(id);
  };
  
   // helper functions for moment normalization 

   function m10(pattern) {
		var sum = 0;
		for(var i=0;i<pattern.length;i++) {
		    var stroke_i = pattern[i];
			for(var j=0;j<stroke_i.length;j++) {
				sum += stroke_i[j][0];
			}			
		}
		return sum;
	};
	
    function m01(pattern) {
		var sum = 0;
		for(var i=0;i<pattern.length;i++) {
			var stroke_i = pattern[i];
			for(var j=0;j<stroke_i.length;j++) {
				sum += stroke_i[j][1];
			}			
		}
		return sum;
	};
		
    function m00(pattern) {
	    var sum = 0;
		for(var i=0;i<pattern.length;i++) {
		   var stroke_i = pattern[i];
		   sum += stroke_i.length;
		}
		return sum;
	};
	
	 function mu20(pattern, xc) {
		var sum = 0;
		for(var i=0;i<pattern.length;i++) {
			var stroke_i = pattern[i];
			for(var j=0;j<stroke_i.length;j++) {
				var diff = stroke_i[j][0] - xc;
				sum += (diff * diff);
			}			
		}
		return sum;
	};
	
	 function mu02(pattern, yc) {
		var sum = 0;
		for(var i=0;i<pattern.length;i++) {
			var stroke_i = pattern[i];
			for(var j=0;j<stroke_i.length;j++) {
				var diff = stroke_i[j][1] - yc;
				sum += (diff * diff);
			}			
		}
		return sum;
	};
   
   	 function aran(width, height) {
		
		var r1 = 0.;
		if(height > width) {
			r1 = width / height;
		} else {
			r1 = height / width;
		}
		
		var a = Math.PI / 2.;
		var b = a * r1;
		var b1 = Math.sin(b);
		var c = Math.sqrt(b1);
		var d = c;
		
		var r2 = Math.sqrt(Math.sin((Math.PI/2.) * r1));
		return r2;
	};
	
	 function chopOverbounds(pattern) {
		
		var chopped = new Array();
		for(var i=0;i<pattern.length;i++) {
		    var stroke_i = pattern[i];
			var c_stroke_i = new Array();
			for(var j=0;j<stroke_i.length;j++) {
			    var x = stroke_i[j][0];
				var y = stroke_i[j][1];			
				if(x < 0) { x = 0; }
				if(x>=256) { x = 255; }
				if(y < 0) { y = 0; }
				if(y>=256) { y = 255; }
				c_stroke_i.push([x,y]);
			}
			chopped.push(c_stroke_i);
		}
		return chopped;		
	};
	
    function transform(pattern, x_, y_) {
	var pt = new Array();
		for(var i=0;i<pattern.length;i++) {
		    var stroke_i = pattern[i];
			var c_stroke_i = new Array();
			for(var j=0;j<stroke_i.length;j++) {
			    var x = stroke_i[j][0]+x_;
				var y = stroke_i[j][1]+y_;
				c_stroke_i.push([x,y]);
			}
			pt.push(c_stroke_i);
		}
		return pt;			
	};

	// main function for moment normalization
	function momentNormalize(pattern) {
			
		newHeight = 256;
		newWidth = 256;
		xMin = 256;
		xMax = 0;
		yMin = 256;
		yMax = 0;
		// first determine drawn character width / length
		for(var i = 0;i<pattern.length;i++) {
		  var stroke_i = pattern[i];
		  for(var j = 0; j<stroke_i.length;j++) {
			x = stroke_i[j][0];
			y = stroke_i[j][1];
			if(x < xMin) {
			  xMin = x;
			}
			if(x > xMax) {
			  xMax = x;
			}
			if(y < yMin) {
			  yMin = y;
			}
			if(y > yMax) {
			  yMax = y;
			}
		  }
		}	
		oldHeight = Math.abs(yMax - yMin);
		oldWidth  = Math.abs(xMax - xMin);
			
		var r2 = aran(oldWidth, oldHeight);
		
		var aranWidth = newWidth;
		var aranHeight = newHeight;
		
		if(oldHeight > oldWidth) {
			aranWidth = r2 * newWidth; 
		} else {
			aranHeight = r2 * newHeight;
		}		
				
		var xOffset = (newWidth - aranWidth)/2;
		var yOffset = (newHeight - aranHeight)/2; 
		
		var m00_ = m00(pattern);
		var m01_ = m01(pattern);
		var m10_ = m10(pattern);
				
		var xc_ = (m10_/m00_);
		var yc_ = (m01_/m00_);
				
		var xc_half = aranWidth/2;
		var yc_half = aranHeight/2;
		
		var mu20_ = mu20(pattern, xc_);
		var mu02_ = mu02(pattern, yc_);

		var alpha = (aranWidth) / (4 * Math.sqrt(mu20_/m00_)) || 0;
		var beta = (aranHeight) / (4 * Math.sqrt(mu02_/m00_)) || 0;
			
		var nf = new Array();
		for(var i=0;i<pattern.length;i++) {
			var si = pattern[i];
			var nsi = new Array();
			for(var j=0;j<si.length;j++) {
				
				var newX = (alpha * (si[j][0] - xc_) + xc_half);
				var newY = (beta * (si[j][1] - yc_) + yc_half);
				
				nsi.push([newX,newY]);
			}
			nf.push(nsi);
		}

		return transform(nf, xOffset, yOffset);
	};
	
  // distance functions
  function euclid(x1y1, x2y2) {
      var a = x1y1[0] - x2y2[0];
      var b = x1y1[1] - x2y2[1];
      var c = Math.sqrt( a*a + b*b );
	  return c;
  };

  // extract points in regular intervals
  function extractFeatures(kanji, interval) {
      var extractedPattern = new Array();
      var nrStrokes = kanji.length;
	  for(var i = 0;i<nrStrokes;i++) {
	      var stroke_i = kanji[i];
		  var extractedStroke_i = new Array();
		  var dist = 0.0;
	      var j = 0;
		  while(j < stroke_i.length) {
		      // always add first point
		      if(j==0) {
			  	  var x1y1 = stroke_i[0];
		          extractedStroke_i.push(x1y1);
			  }
		      if(j > 0) {
			      var x1y1 = stroke_i[j-1];
				  var x2y2 = stroke_i[j];
		          dist += euclid(x1y1, x2y2);
              }
			  if((dist >= interval) && (j>1)) {
			      dist = dist - interval;
				  var x1y1 = stroke_i[j];
				  extractedStroke_i.push(x1y1);
			  }
			  j++;
		  }
		  // if we so far have only one point, always add last point
		  if(extractedStroke_i.length == 1) {
		      var x1y1 = stroke_i[stroke_i.length-1];
		      extractedStroke_i.push(x1y1);
		  } else {
		      if(dist > (0.75 * interval)) {
			      var x1y1 = stroke_i[stroke_i.length-1];
		          extractedStroke_i.push(x1y1);
			  }		  
		  }
		  extractedPattern.push(extractedStroke_i);
	  }
      return extractedPattern;
   };
   
   /* test extraction function
   function extractTest() {
      //var ex = extractFeatures(pattern, 20.);
	  //pattern = ex;

      //redraw(id);
	  
	  var norm = normalizeLinearTest(test4);
	  var ex = extractFeatures(norm, 20.);
	  //console.log(ex);
	  
   }*/
   
   function endPointDistance(pattern1, pattern2) {
       var dist = 0;
	   var l1 = typeof pattern1 == 'undefined' ? 0 : pattern1.length;
	   var l2 = typeof pattern2 == 'undefined' ? 0 : pattern2.length;
       if(l1 == 0 || l2 == 0) {
          return 0;
       } else {
	       var x1y1 = pattern1[0];
		   var x2y2 = pattern2[0];
		   dist += (Math.abs(x1y1[0] - x2y2[0]) + Math.abs(x1y1[1] - x2y2[1]));
           x1y1 = pattern1[l1-1];
		   x2y2 = pattern2[l2-1];
		   dist += (Math.abs(x1y1[0] - x2y2[0]) + Math.abs(x1y1[1] - x2y2[1]));
	   }
	   return dist;
   };
   
   function initialDistance(pattern1, pattern2) {
       var l1 = pattern1.length;
	   var l2 = pattern2.length;
	   var lmin = Math.min(l1,l2);
	   var lmax = Math.max(l1,l2);
	   var dist = 0;
	   for(var i = 0; i<lmin;i++) {
	       var x1y1 = pattern1[i];
		   var x2y2 = pattern2[i];
	       dist += (Math.abs(x1y1[0] - x2y2[0]) + Math.abs(x1y1[1] - x2y2[1]));
	   }
	   return dist * (lmax / lmin);
   };
   
   // given to pattern, determine longer (more strokes)
   // and return quadruple with sorted patterns and their
   // stroke numbers [k1,k2,n,m] where n >= m and 
   // they denote the #of strokes of k1 and k2
   function getLargerAndSize(pattern1, pattern2) {
	   var l1 = typeof pattern1 == 'undefined' ? 0 : pattern1.length;
	   var l2 = typeof pattern2 == 'undefined' ? 0 : pattern2.length;
	   // definitions as in paper 
	   // i.e. n is larger 
	   var n = l1;
	   var m = l2;
	   var k1 = pattern1;
	   var k2 = pattern2;
	   if(l1 < l2) {
	       m = l1;
		   n = l2;
		   k1 = pattern2;
		   k2 = pattern1;
	   }	   	   
       return [k1,k2,n,m];
   };
   
   function wholeWholeDistance(pattern1, pattern2) {
       // [k1, k2, n, m]
       // a[0], a[1], a[2], a[3]
       var a = getLargerAndSize(pattern1, pattern2);
	   var dist = 0;
	   for(var i = 0; i<a[3];i++) {
	       j_of_i = parseInt(parseInt(a[2]/a[3]) * i);
		   var x1y1 = a[0][j_of_i];
		   var x2y2 = a[1][i];
	       dist += (Math.abs(x1y1[0] - x2y2[0]) + Math.abs(x1y1[1] - x2y2[1]));
	   }
	   return parseInt(dist/a[3]);
   };
   
   // initialize N-stroke map by greedy initialization
   function initStrokeMap(pattern1, pattern2, distanceMetric) {
       // [k1, k2, n, m]
       // a[0], a[1], a[2], a[3]
	   var a = getLargerAndSize(pattern1, pattern2);
	   // larger is now k1 with length n
	   var map = new Array();
	   for(var i=0;i<a[2];i++) {
	      map[i] = -1;
	   }
	   var free = new Array();
	   for(var i=0;i<a[2];i++) {
	      free[i] = true;
	   }
	   for(var i=0;i<a[3];i++) {
           minDist = 10000000;
		   min_j = -1;
		   for(var j=0;j<a[2];j++) {
		       if(free[j] == true) {
			       var d = distanceMetric(a[0][j],a[1][i]);
  			       if(d < minDist) {
				       minDist = d;
					   min_j = j;
			       }
			   }
		   }
		   free[min_j] = false;
           map[min_j] = i;
       }	   
	   return map;   
    };

	// get best N-stroke map by iterative improvement
	function getMap(pattern1, pattern2, distanceMetric) {
       // [k1, k2, n, m]
       // a[0], a[1], a[2], a[3]
       var a = getLargerAndSize(pattern1, pattern2);
	   // larger is now k1 with length n
	   var L = 3;
	   var map = initStrokeMap(a[0], a[1], distanceMetric);
	   for(var l=0;l<L;l++) {
	       for(var i=0;i<map.length;i++) {
		       if(map[i] != -1) {
                   dii = distanceMetric(a[0][i], a[1][map[i]]);
				   for(var j=0;j<map.length;j++) {
				       // we need to check again, since 
					   // manipulation of map[i] can occur within
					   // the j-loop
					   if(map[i] != -1) {
					       if(map[j] != -1) {
						      var djj = distanceMetric(a[0][j],a[1][map[j]]);
                              var dij = distanceMetric(a[0][j],a[1][map[i]]);
                              var dji = distanceMetric(a[0][i],a[1][map[j]]);
							  if(dji + dij < dii + djj) {
							      var mapj = map[j];
								  map[j] = map[i];
								  map[i] = mapj;
								  dii = dij;
							  }
						   } else {
						       var dij = distanceMetric(a[0][j], a[1][map[i]]);
                               if(dij < dii) {
                                  map[j] = map[i];
                                  map[i] = -1;
                                  dii = dij;
							    }
						   }
					   }
				   }				   
               }
		   }
	   }
       return map;	   
	};
	
	// from optimal N-stroke map create M-N stroke map
	function completeMap(pattern1, pattern2, distanceMetric, map) {
       // [k1, k2, _, _]
       // a[0], a[1], a[2], a[3]
		var a = getLargerAndSize(pattern1, pattern2);
	    if(!map.includes(-1)) {
		    return map;
		}
		// complete at the end
		var lastUnassigned = map[map.length];
		var mapLastTo = -1;
		for(var i = map.length -1; i>=0;i--) {
		    if(map[i] == -1) {
			    lastUnassigned = i;
			} else {
			    mapLastTo = map[i];
			    break;
			}
		}
		for(var i=lastUnassigned;i<map.length;i++) {
		    map[i] = mapLastTo;
		}
		// complete at the beginning
		var firstUnassigned = -1;
		var mapFirstTo = -1;
		for(var i = 0;i<map.length;i++) {
		    if(map[i] == -1) {
			    firstUnassigned = i;
			} else {
			    mapFirstTo = map[i];
				break;
			}
		}		
		for(var i=0;i<=firstUnassigned;i++) {
		    map[i] = mapFirstTo;
		}
		// for the remaining unassigned, check
		// where to "split"
        for(var i=0;i<map.length;i++) {
            if(i+1 < map.length && map[i+1] == -1) {
               // we have a situation like this:
               //   i       i+1   i+2   ...  i+n 
               //   start   -1    ?     -1   stop
               var start = i;

               var stop = i+1;
               while(stop<map.length && map[stop] == -1) {
                  stop++;
               }

               var div = start;
               var max_dist = 1000000;
               for(var j=start;j<stop;j++) {
                   var stroke_ab = a[0][start];
				   // iteration of concat, possibly slow
				   // due to memory allocations; optimize?!
			     	for(var temp=start+1;temp<=j;temp++) {
				       stroke_ab = stroke_ab.concat(a[0][temp]);
			    	}
				   var stroke_bc = a[0][j+1];

				   for(var temp=j+2;temp<=stop;temp++) {
				       stroke_bc = stroke_bc.concat(a[0][temp]);
				   }

				   var d_ab = distanceMetric(stroke_ab, a[1][map[start]]);
				   var d_bc = distanceMetric(stroke_bc, a[1][map[stop]]);				
                   if(d_ab + d_bc < max_dist) {
                       div = j;
                       max_dist = d_ab + d_bc;
                   }
               }
               for(var j=start;j<=div;j++) {
                   map[j] = map[start];
               }
               for(var j=div+1;j<stop;j++) {
                   map[j] = map[stop];
               }
            } 
        }
    return map;
	};
	
	// given two patterns, M-N stroke map and distanceMetric function,
	// compute overall distance between two patterns
	function computeDistance(pattern1, pattern2, distanceMetric, map) {
         // [k1, k2, n, m]
         // a[0], a[1], a[2], a[3]
	     var a = getLargerAndSize(pattern1, pattern2);
		 var dist = 0.0;
		 var idx = 0;
		 while(idx < a[2]) {
		     var stroke_idx = a[1][map[idx]];
			 var start = idx;
			 var stop  = start+1;
			 while(stop<map.length && map[stop] == map[idx]) {
                  stop++;
             }
			 var stroke_concat = a[0][start];
			 for(var temp=start+1;temp<stop;temp++) {
				stroke_concat = stroke_concat.concat(a[0][temp]);
			 }
			 dist += distanceMetric(stroke_idx, stroke_concat);
			 idx = stop;
		 }
		 return dist;
	};
	
	// given two patterns, M-N strokemap, compute weighted (respect stroke
	// length when there are concatenated strokes using the wholeWhole distance
	function computeWholeDistanceWeighted(pattern1, pattern2, map) {
         // [k1, k2, n, m]
         // a[0], a[1], a[2], a[3]
	     var a = getLargerAndSize(pattern1, pattern2);
		 var dist = 0.0;
		 var idx = 0;
		 while(idx < a[2]) {
		     var stroke_idx = a[1][map[idx]];
			 var start = idx;
			 var stop  = start+1;
			 while(stop<map.length && map[stop] == map[idx]) {
                  stop++;
             }
			 var stroke_concat = a[0][start];
			 for(var temp=start+1;temp<stop;temp++) {
				stroke_concat = stroke_concat.concat(a[0][temp]);
			 }
			 
			 var dist_idx = wholeWholeDistance(stroke_idx, stroke_concat);
			 if(stop > start + 1) {
			    // concatenated stroke, adjust weight
				var mm = typeof stroke_idx == 'undefined' ? 0 : stroke_idx.length;
				var nn = stroke_concat.length;
				if(nn < mm) {
				   var temp = nn;
				   nn = mm;
				   mm = temp;
				}
                dist_idx = dist_idx * (nn/mm);				
			 }
			 dist += dist_idx;
			 idx = stop;
		 }
		 return dist;
	};
	
	// apply coarse classficiation w.r.t. inputPattern
	// considering _all_ referencePatterns using endpoint distance
	function coarseClassification(inputPattern, refPatterns) {
	   var inputLength = inputPattern.length;
	   var candidates = [];
	   for(var i=0;i<refPatterns.length;i++) {
	       var iLength = refPatterns[i][1];
		   if(inputLength < iLength + 2 && inputLength > iLength-3) {
		       var iPattern = refPatterns[i][2];
			   var iMap = getMap(iPattern, inputPattern, endPointDistance);
			   iMap =  completeMap(iPattern, inputPattern, endPointDistance, iMap);
			   var dist = computeDistance(iPattern, inputPattern, endPointDistance, iMap);
			   var m = iLength;
			   var n = iPattern.length;
			   if(n < m) {
			       var temp = n;
				   n = m;
				   m = temp;
			   }
			   candidates.push([i, (dist * (m/n))]);
		   }
	   }
	   candidates.sort(function(a, b){return a[1]-b[1]});
	   return candidates;
	};
	
	// fine classfication. returns best 100 matches for inputPattern
	// and candidate list (which should be provided by coarse classification
	function fineClassification(inputPattern, inputCandidates, refPatterns) {
	   var inputLength = inputPattern.length;
	   var candidates = [];
	   for(var i=0;i<Math.min(inputCandidates.length, 100);i++) {
	       var j = inputCandidates[i][0];
	       var iLength = refPatterns[j][1];
		   var iPattern = refPatterns[j][2];
		      		   if(inputLength < iLength + 2 && inputLength > iLength-3) {

		   var iMap = getMap(iPattern, inputPattern, initialDistance);

		   iMap =  completeMap(iPattern, inputPattern, wholeWholeDistance, iMap);
		   var dist = computeWholeDistanceWeighted(iPattern, inputPattern, iMap);
		   var n = inputLength;
		   var m = iPattern.length;
		   if(m > n) {
		       m = n;
		   }
		   dist = dist / m;
		   candidates.push([j, dist]);
	   }
	   }
	   candidates.sort(function(a, b){return a[1]-b[1]});
	   // Returns the characters themselves rather than the markup the original
	   // built and wrote into an element by id: this module knows nothing about
	   // the DOM.
	   var out = [];
	   for(var i=0;i<Math.min(candidates.length, 10);i++) {
	       out.push(refPatterns[candidates[i][0]][0]);
	   }
	   return out;
	};

export {
  normalizeLinear,
  momentNormalize,
  extractFeatures,
  coarseClassification,
  fineClassification,
  euclid,
};

import {assert} from './asserts.js';
import LayerGroup from './layer/Group.js';
import MapProperty from './MapProperty.js';
import View from './View.js';
import Collection from './Collection.js';

function createOptionsInternal(options) {

  let keyboardEventTarget = null;
  if (options.keyboardEventTarget !== undefined) {
    keyboardEventTarget =
      typeof options.keyboardEventTarget === 'string'
        ? document.getElementById(options.keyboardEventTarget)
        : options.keyboardEventTarget;
  }

  const values = {};

  const layerGroup =
    options.layers &&
    typeof ( (options.layers).getLayers) === 'function'
      ?  (options.layers)
      : new LayerGroup({
          layers:
             (
              options.layers
            ),
        });

  values[MapProperty.LAYERGROUP] = layerGroup;
  values[MapProperty.TARGET] = options.target;
  values[MapProperty.VIEW] = options.view instanceof View ? options.view : new View();

  let controls;
  if (options.controls !== undefined) {
    if (Array.isArray(options.controls)) {
      controls = new Collection(options.controls.slice());
    } else {
      assert(
        typeof ( (options.controls).getArray) === 'function',
        'Expected `controls` to be an array or an `ol/Collection.js`',
      );
      controls = options.controls;
    }
  }

  let interactions;
  if (options.interactions !== undefined) {
    if (Array.isArray(options.interactions)) {
      interactions = new Collection(options.interactions.slice());
    } else {
      assert(
        typeof ( (options.interactions).getArray) ===
          'function',
        'Expected `interactions` to be an array or an `ol/Collection.js`',
      );
      interactions = options.interactions;
    }
  }

  let overlays;
  if (options.overlays !== undefined) {
    if (Array.isArray(options.overlays)) {
      overlays = new Collection(options.overlays.slice());
    } else {
      assert(
        typeof ( (options.overlays).getArray) === 'function',
        'Expected `overlays` to be an array or an `ol/Collection.js`',
      );
      overlays = options.overlays;
    }
  } else {
    overlays = new Collection();
  }

  return {
    controls: controls,
    interactions: interactions,
    keyboardEventTarget: keyboardEventTarget,
    overlays: overlays,
    values: values,
  };
}

export default createOptionsInternal

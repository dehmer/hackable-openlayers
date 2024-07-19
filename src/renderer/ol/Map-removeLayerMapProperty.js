import Layer from './layer/Layer.js';
import LayerGroup from './layer/Group.js';

function removeLayerMapProperty(layer) {
  if (layer instanceof Layer) {
    layer.setMapInternal(null);
    return;
  }
  if (layer instanceof LayerGroup) {
    layer.getLayers().forEach(removeLayerMapProperty);
  }
}

export default removeLayerMapProperty

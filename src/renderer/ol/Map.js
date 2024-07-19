import BaseObject from './Object.js';
import Collection from './Collection.js';
import CollectionEventType from './CollectionEventType.js';
import CompositeMapRenderer from './renderer/Composite.js';
import EventType from './events/EventType.js';
import Layer from './layer/Layer.js';
import LayerGroup, {GroupEvent} from './layer/Group.js';
import MapBrowserEvent from './MapBrowserEvent.js';
import MapBrowserEventHandler from './MapBrowserEventHandler.js';
import MapBrowserEventType from './MapBrowserEventType.js';
import MapEvent from './MapEvent.js';
import MapEventType from './MapEventType.js';
import MapProperty from './MapProperty.js';
import ObjectEventType from './ObjectEventType.js';
import PointerEventType from './pointer/EventType.js';
import RenderEventType from './render/EventType.js';
import TileQueue, {getTilePriority} from './TileQueue.js';
import View from './View.js';
import ViewHint from './ViewHint.js';
import {DEVICE_PIXEL_RATIO, PASSIVE_EVENT_LISTENERS} from './has.js';
import {TRUE} from './functions.js';
import {
  apply as applyTransform,
  create as createTransform,
} from './transform.js';
import {
  clone,
  createOrUpdateEmpty,
  equals as equalsExtent,
  getForViewAndSize,
  isEmpty,
} from './extent.js';
import {defaults as defaultControls} from './control/defaults.js';
import {defaults as defaultInteractions} from './interaction/defaults.js';
import {equals} from './array.js';
import {fromUserCoordinate, toUserCoordinate} from './proj.js';
import {getUid} from './util.js';
import {hasArea} from './size.js';
import {listen, unlistenByKey} from './events.js';
import createOptionsInternal from './Map-createOptionsInternal.js';

function removeLayerMapProperty(layer) {
  if (layer instanceof Layer) {
    layer.setMapInternal(null);
    return;
  }
  if (layer instanceof LayerGroup) {
    layer.getLayers().forEach(removeLayerMapProperty);
  }
}

function setLayerMapProperty(layer, map) {
  if (layer instanceof Layer) {
    layer.setMapInternal(map);
    return;
  }
  if (layer instanceof LayerGroup) {
    const layers = layer.getLayers().getArray();
    for (let i = 0, ii = layers.length; i < ii; ++i) {
      setLayerMapProperty(layers[i], map);
    }
  }
}

class Map extends BaseObject {

  constructor(options) {
    super();

    options = options || {};

    this.on;
    this.once;
    this.un;

    const optionsInternal = createOptionsInternal(options);
    this.renderComplete_ = false;
    this.loaded_ = true;
    this.boundHandleBrowserEvent_ = this.handleBrowserEvent.bind(this);

    this.maxTilesLoading_ =
      options.maxTilesLoading !== undefined ? options.maxTilesLoading : 16;

    this.pixelRatio_ =
      options.pixelRatio !== undefined
        ? options.pixelRatio
        : DEVICE_PIXEL_RATIO;

    this.postRenderTimeoutHandle_;
    this.animationDelayKey_;
    this.animationDelay_ = this.animationDelay_.bind(this);
    this.coordinateToPixelTransform_ = createTransform();
    this.pixelToCoordinateTransform_ = createTransform();
    this.frameIndex_ = 0;
    this.frameState_ = null;
    this.previousExtent_ = null;
    this.viewPropertyListenerKey_ = null;
    this.viewChangeListenerKey_ = null;
    this.layerGroupPropertyListenerKeys_ = null;
    this.viewport_ = document.createElement('div');
    this.viewport_.className =
      'ol-viewport' + ('ontouchstart' in window ? ' ol-touch' : '');
    this.viewport_.style.position = 'relative';
    this.viewport_.style.overflow = 'hidden';
    this.viewport_.style.width = '100%';
    this.viewport_.style.height = '100%';

    this.overlayContainer_ = document.createElement('div');
    this.overlayContainer_.style.position = 'absolute';
    this.overlayContainer_.style.zIndex = '0';
    this.overlayContainer_.style.width = '100%';
    this.overlayContainer_.style.height = '100%';
    this.overlayContainer_.style.pointerEvents = 'none';
    this.overlayContainer_.className = 'ol-overlaycontainer';
    this.viewport_.appendChild(this.overlayContainer_);

    this.overlayContainerStopEvent_ = document.createElement('div');
    this.overlayContainerStopEvent_.style.position = 'absolute';
    this.overlayContainerStopEvent_.style.zIndex = '0';
    this.overlayContainerStopEvent_.style.width = '100%';
    this.overlayContainerStopEvent_.style.height = '100%';
    this.overlayContainerStopEvent_.style.pointerEvents = 'none';
    this.overlayContainerStopEvent_.className = 'ol-overlaycontainer-stopevent';
    this.viewport_.appendChild(this.overlayContainerStopEvent_);
    this.mapBrowserEventHandler_ = null;
    this.moveTolerance_ = options.moveTolerance;
    this.keyboardEventTarget_ = optionsInternal.keyboardEventTarget;
    this.targetChangeHandlerKeys_ = null;
    this.targetElement_ = null;
    this.resizeObserver_ = new ResizeObserver(() => this.updateSize());
    this.controls = optionsInternal.controls || defaultControls();

    this.interactions =
      optionsInternal.interactions ||
      defaultInteractions({
        onFocusOnly: true,
      });

    this.overlays_ = optionsInternal.overlays;
    this.overlayIdIndex_ = {};
    this.renderer_ = null;
    this.postRenderFunctions_ = [];

    this.tileQueue_ = new TileQueue(
      this.getTilePriority.bind(this),
      this.handleTileChange_.bind(this),
    );

    this.addChangeListener(
      MapProperty.LAYERGROUP,
      this.handleLayerGroupChanged_,
    );

    this.addChangeListener(MapProperty.VIEW, this.handleViewChanged_);
    this.addChangeListener(MapProperty.SIZE, this.handleSizeChanged_);
    this.addChangeListener(MapProperty.TARGET, this.handleTargetChanged_);
    this.setProperties(optionsInternal.values);

    const map = this;
    if (options.view && !(options.view instanceof View)) {
      options.view.then(function (viewOptions) {
        map.setView(new View(viewOptions));
      });
    }

    this.controls.addEventListener(
      CollectionEventType.ADD,

      (event) => {
        event.element.setMap(this);
      },
    );

    this.controls.addEventListener(
      CollectionEventType.REMOVE,

      (event) => {
        event.element.setMap(null);
      },
    );

    this.interactions.addEventListener(
      CollectionEventType.ADD,

      (event) => {
        event.element.setMap(this);
      },
    );

    this.interactions.addEventListener(
      CollectionEventType.REMOVE,

      (event) => {
        event.element.setMap(null);
      },
    );

    this.overlays_.addEventListener(
      CollectionEventType.ADD,

      (event) => {
        this.addOverlayInternal_(event.element);
      },
    );

    this.overlays_.addEventListener(
      CollectionEventType.REMOVE,

      (event) => {
        const id = event.element.getId();
        if (id !== undefined) {
          delete this.overlayIdIndex_[id.toString()];
        }
        event.element.setMap(null);
      },
    );

    this.controls.forEach(

      (control) => {
        control.setMap(this);
      },
    );

    this.interactions.forEach(

      (interaction) => {
        interaction.setMap(this);
      },
    );

    this.overlays_.forEach(this.addOverlayInternal_.bind(this));
  }

  addControl(control) {
    this.getControls().push(control);
  }

  addInteraction(interaction) {
    this.getInteractions().push(interaction);
  }

  addLayer(layer) {
    const layers = this.getLayerGroup().getLayers();
    layers.push(layer);
  }

  handleLayerAdd_(event) {
    setLayerMapProperty(event.layer, this);
  }

  addOverlay(overlay) {
    this.getOverlays().push(overlay);
  }

  addOverlayInternal_(overlay) {
    const id = overlay.getId();
    if (id !== undefined) {
      this.overlayIdIndex_[id.toString()] = overlay;
    }
    overlay.setMap(this);
  }

  disposeInternal() {
    this.controls.clear();
    this.interactions.clear();
    this.overlays_.clear();
    this.resizeObserver_.disconnect();
    this.setTarget(null);
    super.disposeInternal();
  }

  forEachFeatureAtPixel(pixel, callback, options) {
    if (!this.frameState_ || !this.renderer_) {
      return;
    }
    const coordinate = this.getCoordinateFromPixelInternal(pixel);
    options = options !== undefined ? options : {};
    const hitTolerance =
      options.hitTolerance !== undefined ? options.hitTolerance : 0;
    const layerFilter =
      options.layerFilter !== undefined ? options.layerFilter : TRUE;
    const checkWrapped = options.checkWrapped !== false;
    return this.renderer_.forEachFeatureAtCoordinate(
      coordinate,
      this.frameState_,
      hitTolerance,
      checkWrapped,
      callback,
      null,
      layerFilter,
      null,
    );
  }

  getFeaturesAtPixel(pixel, options) {
    const features = [];
    this.forEachFeatureAtPixel(
      pixel,
      function (feature) {
        features.push(feature);
      },
      options,
    );
    return features;
  }

  getAllLayers() {
    const layers = [];
    function addLayersFrom(layerGroup) {
      layerGroup.forEach(function (layer) {
        if (layer instanceof LayerGroup) {
          addLayersFrom(layer.getLayers());
        } else {
          layers.push(layer);
        }
      });
    }
    addLayersFrom(this.getLayers());
    return layers;
  }

  hasFeatureAtPixel(pixel, options) {
    if (!this.frameState_ || !this.renderer_) {
      return false;
    }
    const coordinate = this.getCoordinateFromPixelInternal(pixel);
    options = options !== undefined ? options : {};
    const layerFilter =
      options.layerFilter !== undefined ? options.layerFilter : TRUE;
    const hitTolerance =
      options.hitTolerance !== undefined ? options.hitTolerance : 0;
    const checkWrapped = options.checkWrapped !== false;
    return this.renderer_.hasFeatureAtCoordinate(
      coordinate,
      this.frameState_,
      hitTolerance,
      checkWrapped,
      layerFilter,
      null,
    );
  }

  getEventCoordinate(event) {
    return this.getCoordinateFromPixel(this.getEventPixel(event));
  }

  getEventCoordinateInternal(event) {
    return this.getCoordinateFromPixelInternal(this.getEventPixel(event));
  }

  getEventPixel(event) {
    const viewport = this.viewport_;
    const viewportPosition = viewport.getBoundingClientRect();
    const viewportSize = this.getSize();
    const scaleX = viewportPosition.width / viewportSize[0];
    const scaleY = viewportPosition.height / viewportSize[1];
    const eventPosition =

      'changedTouches' in event
        ?  (event).changedTouches[0]
        :  (event);

    return [
      (eventPosition.clientX - viewportPosition.left) / scaleX,
      (eventPosition.clientY - viewportPosition.top) / scaleY,
    ];
  }

  getTarget() {
    return  (
      this.get(MapProperty.TARGET)
    );
  }

  getTargetElement() {
    return this.targetElement_;
  }

  getCoordinateFromPixel(pixel) {
    return toUserCoordinate(
      this.getCoordinateFromPixelInternal(pixel),
      this.getView().getProjection(),
    );
  }

  getCoordinateFromPixelInternal(pixel) {
    const frameState = this.frameState_;
    if (!frameState) {
      return null;
    }
    return applyTransform(frameState.pixelToCoordinateTransform, pixel.slice());
  }

  getControls() {
    return this.controls;
  }

  getOverlays() {
    return this.overlays_;
  }

  getOverlayById(id) {
    const overlay = this.overlayIdIndex_[id.toString()];
    return overlay !== undefined ? overlay : null;
  }

  getInteractions() {
    return this.interactions;
  }

  getLayerGroup() {
    return  (this.get(MapProperty.LAYERGROUP));
  }

  setLayers(layers) {
    const group = this.getLayerGroup();
    if (layers instanceof Collection) {
      group.setLayers(layers);
      return;
    }

    const collection = group.getLayers();
    collection.clear();
    collection.extend(layers);
  }

  getLayers() {
    const layers = this.getLayerGroup().getLayers();
    return layers;
  }

  getLoadingOrNotReady() {
    const layerStatesArray = this.getLayerGroup().getLayerStatesArray();
    for (let i = 0, ii = layerStatesArray.length; i < ii; ++i) {
      const state = layerStatesArray[i];
      if (!state.visible) {
        continue;
      }
      const renderer = state.layer.getRenderer();
      if (renderer && !renderer.ready) {
        return true;
      }
      const source = state.layer.getSource();
      if (source && source.loading) {
        return true;
      }
    }
    return false;
  }

  getPixelFromCoordinate(coordinate) {
    const viewCoordinate = fromUserCoordinate(
      coordinate,
      this.getView().getProjection(),
    );
    return this.getPixelFromCoordinateInternal(viewCoordinate);
  }

  getPixelFromCoordinateInternal(coordinate) {
    const frameState = this.frameState_;
    if (!frameState) {
      return null;
    }
    return applyTransform(
      frameState.coordinateToPixelTransform,
      coordinate.slice(0, 2),
    );
  }

  getRenderer() {
    return this.renderer_;
  }

  getSize() {
    return  (
      this.get(MapProperty.SIZE)
    );
  }

  getView() {
    return  (this.get(MapProperty.VIEW));
  }

  getViewport() {
    return this.viewport_;
  }

  getOverlayContainer() {
    return this.overlayContainer_;
  }

  getOverlayContainerStopEvent() {
    return this.overlayContainerStopEvent_;
  }

  getOwnerDocument() {
    const targetElement = this.getTargetElement();
    return targetElement ? targetElement.ownerDocument : document;
  }

  getTilePriority(tile, tileSourceKey, tileCenter, tileResolution) {
    return getTilePriority(
      this.frameState_,
      tile,
      tileSourceKey,
      tileCenter,
      tileResolution,
    );
  }

  handleBrowserEvent(browserEvent, type) {
    type = type || browserEvent.type;
    const mapBrowserEvent = new MapBrowserEvent(type, this, browserEvent);
    this.handleMapBrowserEvent(mapBrowserEvent);
  }

  handleMapBrowserEvent(mapBrowserEvent) {
    if (!this.frameState_) {

      return;
    }
    const originalEvent =  (
      mapBrowserEvent.originalEvent
    );
    const eventType = originalEvent.type;
    if (
      eventType === PointerEventType.POINTERDOWN ||
      eventType === EventType.WHEEL ||
      eventType === EventType.KEYDOWN
    ) {
      const doc = this.getOwnerDocument();
      const rootNode = this.viewport_.getRootNode
        ? this.viewport_.getRootNode()
        : doc;
      const target =  (originalEvent.target);
      if (

        this.overlayContainerStopEvent_.contains(target) ||

        !(rootNode === doc ? doc.documentElement : rootNode).contains(target)
      ) {
        return;
      }
    }
    mapBrowserEvent.frameState = this.frameState_;
    if (this.dispatchEvent(mapBrowserEvent) !== false) {
      const interactionsArray = this.getInteractions().getArray().slice();
      for (let i = interactionsArray.length - 1; i >= 0; i--) {
        const interaction = interactionsArray[i];
        if (
          interaction.getMap() !== this ||
          !interaction.getActive() ||
          !this.getTargetElement()
        ) {
          continue;
        }
        const cont = interaction.handleEvent(mapBrowserEvent);
        if (!cont || mapBrowserEvent.propagationStopped) {
          break;
        }
      }
    }
  }

  handlePostRender() {
    const frameState = this.frameState_;

    const tileQueue = this.tileQueue_;
    if (!tileQueue.isEmpty()) {
      let maxTotalLoading = this.maxTilesLoading_;
      let maxNewLoads = maxTotalLoading;
      if (frameState) {
        const hints = frameState.viewHints;
        if (hints[ViewHint.ANIMATING] || hints[ViewHint.INTERACTING]) {
          const lowOnFrameBudget = Date.now() - frameState.time > 8;
          maxTotalLoading = lowOnFrameBudget ? 0 : 8;
          maxNewLoads = lowOnFrameBudget ? 0 : 2;
        }
      }
      if (tileQueue.getTilesLoading() < maxTotalLoading) {
        tileQueue.reprioritize();
        tileQueue.loadMoreTiles(maxTotalLoading, maxNewLoads);
      }
    }

    if (frameState && this.renderer_ && !frameState.animate) {
      if (this.renderComplete_) {
        if (this.hasListener(RenderEventType.RENDERCOMPLETE)) {
          this.renderer_.dispatchRenderEvent(
            RenderEventType.RENDERCOMPLETE,
            frameState,
          );
        }
        if (this.loaded_ === false) {
          this.loaded_ = true;
          this.dispatchEvent(
            new MapEvent(MapEventType.LOADEND, this, frameState),
          );
        }
      } else if (this.loaded_ === true) {
        this.loaded_ = false;
        this.dispatchEvent(
          new MapEvent(MapEventType.LOADSTART, this, frameState),
        );
      }
    }

    const postRenderFunctions = this.postRenderFunctions_;
    for (let i = 0, ii = postRenderFunctions.length; i < ii; ++i) {
      postRenderFunctions[i](this, frameState);
    }
    postRenderFunctions.length = 0;
  }

  handleSizeChanged_() {
    if (this.getView() && !this.getView().getAnimating()) {
      this.getView().resolveConstraints(0);
    }

    this.render();
  }

  handleTargetChanged_() {
    if (this.mapBrowserEventHandler_) {
      for (let i = 0, ii = this.targetChangeHandlerKeys_.length; i < ii; ++i) {
        unlistenByKey(this.targetChangeHandlerKeys_[i]);
      }
      this.targetChangeHandlerKeys_ = null;
      this.viewport_.removeEventListener(
        EventType.CONTEXTMENU,
        this.boundHandleBrowserEvent_,
      );
      this.viewport_.removeEventListener(
        EventType.WHEEL,
        this.boundHandleBrowserEvent_,
      );
      this.mapBrowserEventHandler_.dispose();
      this.mapBrowserEventHandler_ = null;
      this.viewport_.remove();
    }

    if (this.targetElement_) {
      this.resizeObserver_.unobserve(this.targetElement_);
      const rootNode = this.targetElement_.getRootNode();
      if (rootNode instanceof ShadowRoot) {
        this.resizeObserver_.unobserve(rootNode.host);
      }
      this.setSize(undefined);
    }

    const target = this.getTarget();
    const targetElement =
      typeof target === 'string' ? document.getElementById(target) : target;
    this.targetElement_ = targetElement;
    if (!targetElement) {
      if (this.renderer_) {
        clearTimeout(this.postRenderTimeoutHandle_);
        this.postRenderTimeoutHandle_ = undefined;
        this.postRenderFunctions_.length = 0;
        this.renderer_.dispose();
        this.renderer_ = null;
      }
      if (this.animationDelayKey_) {
        cancelAnimationFrame(this.animationDelayKey_);
        this.animationDelayKey_ = undefined;
      }
    } else {
      targetElement.appendChild(this.viewport_);
      if (!this.renderer_) {
        this.renderer_ = new CompositeMapRenderer(this);
      }

      this.mapBrowserEventHandler_ = new MapBrowserEventHandler(
        this,
        this.moveTolerance_,
      );
      for (const key in MapBrowserEventType) {
        this.mapBrowserEventHandler_.addEventListener(
          MapBrowserEventType[key],
          this.handleMapBrowserEvent.bind(this),
        );
      }
      this.viewport_.addEventListener(
        EventType.CONTEXTMENU,
        this.boundHandleBrowserEvent_,
        false,
      );
      this.viewport_.addEventListener(
        EventType.WHEEL,
        this.boundHandleBrowserEvent_,
        PASSIVE_EVENT_LISTENERS ? {passive: false} : false,
      );

      const keyboardEventTarget = !this.keyboardEventTarget_
        ? targetElement
        : this.keyboardEventTarget_;
      this.targetChangeHandlerKeys_ = [
        listen(
          keyboardEventTarget,
          EventType.KEYDOWN,
          this.handleBrowserEvent,
          this,
        ),
        listen(
          keyboardEventTarget,
          EventType.KEYPRESS,
          this.handleBrowserEvent,
          this,
        ),
      ];
      const rootNode = targetElement.getRootNode();
      if (rootNode instanceof ShadowRoot) {
        this.resizeObserver_.observe(rootNode.host);
      }
      this.resizeObserver_.observe(targetElement);
    }

    this.updateSize();

  }

  handleTileChange_() {
    this.render();
  }

  handleViewPropertyChanged_() {
    this.render();
  }

  handleViewChanged_() {
    if (this.viewPropertyListenerKey_) {
      unlistenByKey(this.viewPropertyListenerKey_);
      this.viewPropertyListenerKey_ = null;
    }
    if (this.viewChangeListenerKey_) {
      unlistenByKey(this.viewChangeListenerKey_);
      this.viewChangeListenerKey_ = null;
    }
    const view = this.getView();
    if (view) {
      this.updateViewportSize_(this.getSize());

      this.viewPropertyListenerKey_ = listen(
        view,
        ObjectEventType.PROPERTYCHANGE,
        this.handleViewPropertyChanged_,
        this,
      );
      this.viewChangeListenerKey_ = listen(
        view,
        EventType.CHANGE,
        this.handleViewPropertyChanged_,
        this,
      );

      view.resolveConstraints(0);
    }
    this.render();
  }

  handleLayerGroupChanged_() {
    if (this.layerGroupPropertyListenerKeys_) {
      this.layerGroupPropertyListenerKeys_.forEach(unlistenByKey);
      this.layerGroupPropertyListenerKeys_ = null;
    }
    const layerGroup = this.getLayerGroup();
    if (layerGroup) {
      this.handleLayerAdd_(new GroupEvent('addlayer', layerGroup));
      this.layerGroupPropertyListenerKeys_ = [
        listen(layerGroup, ObjectEventType.PROPERTYCHANGE, this.render, this),
        listen(layerGroup, EventType.CHANGE, this.render, this),
        listen(layerGroup, 'addlayer', this.handleLayerAdd_, this),
        listen(layerGroup, 'removelayer', this.handleLayerRemove_, this),
      ];
    }
    this.render();
  }

  isRendered() {
    return !!this.frameState_;
  }

  animationDelay_() {
    this.animationDelayKey_ = undefined;
    this.renderFrame_(Date.now());
  }

  renderSync() {
    if (this.animationDelayKey_) {
      cancelAnimationFrame(this.animationDelayKey_);
    }
    this.animationDelay_();
  }

  redrawText() {
    const layerStates = this.getLayerGroup().getLayerStatesArray();
    for (let i = 0, ii = layerStates.length; i < ii; ++i) {
      const layer = layerStates[i].layer;
      if (layer.hasRenderer()) {
        layer.getRenderer().handleFontsChanged();
      }
    }
  }

  render() {
    if (this.renderer_ && this.animationDelayKey_ === undefined) {
      this.animationDelayKey_ = requestAnimationFrame(this.animationDelay_);
    }
  }

  removeControl(control) {
    return this.getControls().remove(control);
  }

  removeInteraction(interaction) {
    return this.getInteractions().remove(interaction);
  }

  removeLayer(layer) {
    const layers = this.getLayerGroup().getLayers();
    return layers.remove(layer);
  }

  handleLayerRemove_(event) {
    removeLayerMapProperty(event.layer);
  }

  removeOverlay(overlay) {
    return this.getOverlays().remove(overlay);
  }

  renderFrame_(time) {
    const size = this.getSize();
    const view = this.getView();
    const previousFrameState = this.frameState_;

    let frameState = null;
    if (size !== undefined && hasArea(size) && view && view.isDef()) {
      const viewHints = view.getHints(
        this.frameState_ ? this.frameState_.viewHints : undefined,
      );
      const viewState = view.getState();
      frameState = {
        animate: false,
        coordinateToPixelTransform: this.coordinateToPixelTransform_,
        declutter: null,
        extent: getForViewAndSize(
          viewState.center,
          viewState.resolution,
          viewState.rotation,
          size,
        ),
        index: this.frameIndex_++,
        layerIndex: 0,
        layerStatesArray: this.getLayerGroup().getLayerStatesArray(),
        pixelRatio: this.pixelRatio_,
        pixelToCoordinateTransform: this.pixelToCoordinateTransform_,
        postRenderFunctions: [],
        size: size,
        tileQueue: this.tileQueue_,
        time: time,
        usedTiles: {},
        viewState: viewState,
        viewHints: viewHints,
        wantedTiles: {},
        mapId: getUid(this),
        renderTargets: {},
      };
      if (viewState.nextCenter && viewState.nextResolution) {
        const rotation = isNaN(viewState.nextRotation)
          ? viewState.rotation
          : viewState.nextRotation;

        frameState.nextExtent = getForViewAndSize(
          viewState.nextCenter,
          viewState.nextResolution,
          rotation,
          size,
        );
      }
    }

    this.frameState_ = frameState;
    this.renderer_.renderFrame(frameState);

    if (frameState) {
      if (frameState.animate) {
        this.render();
      }
      Array.prototype.push.apply(
        this.postRenderFunctions_,
        frameState.postRenderFunctions,
      );

      if (previousFrameState) {
        const moveStart =
          !this.previousExtent_ ||
          (!isEmpty(this.previousExtent_) &&
            !equalsExtent(frameState.extent, this.previousExtent_));
        if (moveStart) {
          this.dispatchEvent(
            new MapEvent(MapEventType.MOVESTART, this, previousFrameState),
          );
          this.previousExtent_ = createOrUpdateEmpty(this.previousExtent_);
        }
      }

      const idle =
        this.previousExtent_ &&
        !frameState.viewHints[ViewHint.ANIMATING] &&
        !frameState.viewHints[ViewHint.INTERACTING] &&
        !equalsExtent(frameState.extent, this.previousExtent_);

      if (idle) {
        this.dispatchEvent(
          new MapEvent(MapEventType.MOVEEND, this, frameState),
        );
        clone(frameState.extent, this.previousExtent_);
      }
    }

    this.dispatchEvent(new MapEvent(MapEventType.POSTRENDER, this, frameState));

    this.renderComplete_ =
      (this.hasListener(MapEventType.LOADSTART) ||
        this.hasListener(MapEventType.LOADEND) ||
        this.hasListener(RenderEventType.RENDERCOMPLETE)) &&
      !this.tileQueue_.getTilesLoading() &&
      !this.tileQueue_.getCount() &&
      !this.getLoadingOrNotReady();

    if (!this.postRenderTimeoutHandle_) {
      this.postRenderTimeoutHandle_ = setTimeout(() => {
        this.postRenderTimeoutHandle_ = undefined;
        this.handlePostRender();
      }, 0);
    }
  }

  setLayerGroup(layerGroup) {
    const oldLayerGroup = this.getLayerGroup();
    if (oldLayerGroup) {
      this.handleLayerRemove_(new GroupEvent('removelayer', oldLayerGroup));
    }
    this.set(MapProperty.LAYERGROUP, layerGroup);
  }

  setSize(size) {
    this.set(MapProperty.SIZE, size);
  }

  setTarget(target) {
    this.set(MapProperty.TARGET, target);
  }

  setView(view) {
    if (!view || view instanceof View) {
      this.set(MapProperty.VIEW, view);
      return;
    }
    this.set(MapProperty.VIEW, new View());

    const map = this;
    view.then(function (viewOptions) {
      map.setView(new View(viewOptions));
    });
  }

  updateSize() {
    const targetElement = this.getTargetElement();

    let size = undefined;
    if (targetElement) {
      const computedStyle = getComputedStyle(targetElement);
      const width =
        targetElement.offsetWidth -
        parseFloat(computedStyle['borderLeftWidth']) -
        parseFloat(computedStyle['paddingLeft']) -
        parseFloat(computedStyle['paddingRight']) -
        parseFloat(computedStyle['borderRightWidth']);
      const height =
        targetElement.offsetHeight -
        parseFloat(computedStyle['borderTopWidth']) -
        parseFloat(computedStyle['paddingTop']) -
        parseFloat(computedStyle['paddingBottom']) -
        parseFloat(computedStyle['borderBottomWidth']);
      if (!isNaN(width) && !isNaN(height)) {
        size = [width, height];
        if (
          !hasArea(size) &&
          !!(
            targetElement.offsetWidth ||
            targetElement.offsetHeight ||
            targetElement.getClientRects().length
          )
        ) {
          warn(
            "No map visible because the map container's width or height are 0.",
          );
        }
      }
    }

    const oldSize = this.getSize();
    if (size && (!oldSize || !equals(size, oldSize))) {
      this.setSize(size);
      this.updateViewportSize_(size);
    }
  }

  updateViewportSize_(size) {
    const view = this.getView();
    if (view) {
      view.setViewportSize(size);
    }
  }
}

export default Map;

import { getLayers, getActiveLayer, getVisibleLayers } from '../layers.js';
import { addGrayscaleLayer } from '../rendering/renderGrayscaleImage.js';
import { addColorLayer } from '../rendering/renderColorImage.js';
import { addPseudoColorLayer } from '../rendering/renderPseudoColorImage.js';
import { addLabelMapLayer } from '../rendering/renderLabelMapImage.js';
import setToPixelCoordinateSystem from '../setToPixelCoordinateSystem.js';
import { Transform } from './transform.js';
import getImageFitScale from './getImageFitScale.js';

function getViewportRatio (baseLayer, targetLayer) {
  if (!baseLayer.syncProps) {
    updateLayerSyncProps(baseLayer);
  }

  if (!targetLayer.syncProps) {
    updateLayerSyncProps(targetLayer);
  }

  return targetLayer.syncProps.originalScale / baseLayer.syncProps.originalScale;
}

function updateLayerSyncProps (layer) {
  const syncProps = layer.syncProps || {};

  // This is used to keep each of the layers' viewports in sync with the active layer
  syncProps.originalScale = layer.viewport.scale;

  layer.syncProps = syncProps;
}

// Sync all viewports based on active layer's viewport
function syncViewports (layers, activeLayer) {
  // If we intend to keep the viewport's scale, translation and rotation in sync,
  // loop through the layers
  layers.forEach((layer) => {
    // Don't do anything to the active layer
    // Don't do anything if this layer has no viewport
    if (layer === activeLayer ||
        !layer.viewport ||
        !activeLayer.viewport) {
      return;
    }

    if (!layer.syncProps) {
      updateLayerSyncProps(layer);
    }

    const viewportRatio = getViewportRatio(activeLayer, layer);

    // Update the layer's translation and scale to keep them in sync with the first image
    // based on the ratios between the images
    layer.viewport.scale = activeLayer.viewport.scale * viewportRatio;
    layer.viewport.rotation = activeLayer.viewport.rotation;
    layer.viewport.translation = {
      x: (activeLayer.viewport.translation.x / viewportRatio),
      y: (activeLayer.viewport.translation.y / viewportRatio)
    };
    layer.viewport.hflip = activeLayer.viewport.hflip;
    layer.viewport.vflip = activeLayer.viewport.vflip;
  });
}

/**
 * Internal function to render all layers for a Cornerstone enabled element
 *
 * @param {CanvasRenderingContext2D} context Canvas context to draw upon
 * @param {EnabledElementLayer[]} layers The array of all layers for this enabled element
 * @param {activeLayer} layers the layers
 * @param {Boolean} invalidated A boolean whether or not this image has been invalidated and must be redrawn
 * @returns {void}
 * @memberof Internal
 */
function renderLayers (context, layers, activeLayer, invalidated) {
  // Loop through each layer and draw it to the canvas
  layers.forEach((layer, index) => {
    if (!layer.image) {
      return;
    }

    context.save();

    // Set the layer's canvas to the pixel coordinate system
    layer.canvas = context.canvas;

    if (layer.image.imageId.indexOf('petmpr') > -1 && layer.image.imageId.indexOf('Axial') === -1) {
      const transform = calculatePetFuisonTransform(layer, activeLayer);

      context.setTransform(transform.m[0], transform.m[1], transform.m[2], transform.m[3], transform.m[4], transform.m[5]);
    } else {
      setToPixelCoordinateSystem(layer, context);
    }

    // Render into the layer's canvas
    const colormap = layer.viewport.colormap || layer.options.colormap;
    const labelmap = layer.viewport.labelmap;
    const isInvalid = layer.invalid || invalidated;

    if (colormap && colormap !== '' && labelmap === true) {
      addLabelMapLayer(layer, isInvalid);
    } else if (colormap && colormap !== '') {
      addPseudoColorLayer(layer, isInvalid);
    } else if (layer.image.color === true) {
      addColorLayer(layer, isInvalid);
    } else {
      // If this is the base layer, use the alpha channel for rendering of the grayscale image
      const useAlphaChannel = (index === 0);

      addGrayscaleLayer(layer, isInvalid, useAlphaChannel);
    }

    // Apply any global opacity settings that have been defined for this layer
    if (layer.options && layer.options.opacity) {
      context.globalAlpha = layer.options.opacity;
    } else {
      context.globalAlpha = 1;
    }

    if (layer.options && layer.options.fillStyle) {
      context.fillStyle = layer.options.fillStyle;
    }

    // Set the pixelReplication property before drawing from the layer into the
    // composite canvas
    context.imageSmoothingEnabled = !layer.viewport.pixelReplication;
    context.mozImageSmoothingEnabled = context.imageSmoothingEnabled;

    // Draw from the current layer's canvas onto the enabled element's canvas
    const sx = layer.viewport.displayedArea.tlhc.x - 1;
    const sy = layer.viewport.displayedArea.tlhc.y - 1;
    const width = layer.viewport.displayedArea.brhc.x - sx;
    const height = layer.viewport.displayedArea.brhc.y - sy;

    context.drawImage(layer.canvas, sx, sy, width, height, 0, 0, width, height);
    context.restore();

    layer.invalid = false;
  });
}

/**
 * Internal API function to draw a composite image to a given enabled element
 *
 * @param {EnabledElement} enabledElement An enabled element to draw into
 * @param {Boolean} invalidated - true if pixel data has been invalidated and cached rendering should not be used
 * @returns {void}
 */
export default function (enabledElement, invalidated) {
  const element = enabledElement.element;
  const allLayers = getLayers(element);
  const activeLayer = getActiveLayer(element);
  const visibleLayers = getVisibleLayers(element);
  const resynced = !enabledElement.lastSyncViewportsState && enabledElement.syncViewports;

  // This state will help us to determine if the user has re-synced the
  // layers allowing us to make a new copy of the viewports
  enabledElement.lastSyncViewportsState = enabledElement.syncViewports;

  // Stores a copy of all viewports if the user has just synced them then we can use the
  // copies to calculate anything later (ratio, translation offset, rotation offset, etc)
  if (resynced) {
    allLayers.forEach(function (layer) {
      if (layer.viewport) {
        updateLayerSyncProps(layer);
      }
    });
  }

  const bResetPetScale = allLayers.some((layer) => {
    return layer.options && layer.options.name && layer.options.name === 'PET' && layer.options.reSize;
  });

  if (bResetPetScale) {
    const ctFusionLayer = allLayers.filter((layer) => {
      return layer.options.name !== 'PET';
    });

    for (const layer of allLayers) {
      if (layer.options.name === 'PET') {
        if (layer.image.imageId.indexOf('petmpr') > -1 && layer.image.imageId.indexOf('Axial') === -1) {
          if (layer.image.height < layer.image.width) {
            layer.viewport.scale = getImageFitScale(enabledElement.canvas, layer.image, 0).horizontalScale;
          } else {
            layer.viewport.scale = getImageFitScale(enabledElement.canvas, layer.image, 0).verticalScale;
          }
        } else {
          layer.viewport.scale = getImageFitScale(enabledElement.canvas, layer.image, 0).scaleFactor;
        }
        rescaleImage(ctFusionLayer[0], layer);
        layer.options.reSize = false;
      }
      if (layer.viewport) {
        updateLayerSyncProps(layer);
      }
    }
    syncViewports(visibleLayers, activeLayer);
  }

  // Sync all viewports in case it's activated
  if (enabledElement.syncViewports === true) {
    syncViewports(visibleLayers, activeLayer);
  }

  // Get the enabled element's canvas so we can draw to it
  const context = enabledElement.canvas.getContext('2d');

  context.setTransform(1, 0, 0, 1, 0, 0);

  // Clear the canvas
  context.fillStyle = 'black';
  context.fillRect(0, 0, enabledElement.canvas.width, enabledElement.canvas.height);

  // Render all visible layers
  renderLayers(context, visibleLayers, activeLayer, invalidated);
}

/**
 * Calculate the transform for a pet mpr fusion
 *
 * @param {EnabledElement} enabledElement The Cornerstone Enabled Element
 * @param {activeLayer} activeLayer the active layer
 * @return {Transform} The current transform
 * @memberof Internal
 */
function calculatePetFuisonTransform (enabledElement, activeLayer) {
  // Apply the scale
  let activeWidthScale = activeLayer.viewport.scale;
  let activeHeightScale = activeLayer.viewport.scale;

  if (activeLayer.image.rowPixelSpacing < activeLayer.image.columnPixelSpacing) {
    activeWidthScale *= (activeLayer.image.columnPixelSpacing / activeLayer.image.rowPixelSpacing);
  } else if (activeLayer.image.columnPixelSpacing < activeLayer.image.rowPixelSpacing) {
    activeHeightScale *= (activeLayer.image.rowPixelSpacing / activeLayer.image.columnPixelSpacing);
  }

  const transform = new Transform();

  // Move to center of canvas
  transform.translate(enabledElement.canvas.width / 2, enabledElement.canvas.height / 2);

  // Apply the rotation before scaling for non square pixels
  const angle = enabledElement.viewport.rotation;

  if (angle !== 0) {
    transform.rotate(angle * Math.PI / 180);
  }

  // Apply the scale
  let widthScale = activeWidthScale;
  let heightScale = activeHeightScale;

  const width = enabledElement.viewport.displayedArea.brhc.x - (enabledElement.viewport.displayedArea.tlhc.x - 1);
  const height = enabledElement.viewport.displayedArea.brhc.y - (enabledElement.viewport.displayedArea.tlhc.y - 1);
  const activeHeight = activeLayer.viewport.displayedArea.brhc.y - (activeLayer.viewport.displayedArea.tlhc.y - 1);

  const viewportRatio = getViewportRatio(activeLayer, enabledElement);

  widthScale *= viewportRatio;
  heightScale *= activeHeight / height;

  transform.scale(widthScale, heightScale);

  // Unrotate to so we can translate unrotated
  if (angle !== 0) {
    transform.rotate(-angle * Math.PI / 180);
  }

  // Apply the pan offset
  transform.translate(enabledElement.viewport.translation.x, enabledElement.viewport.translation.y);

  // Rotate again so we can apply general scale
  if (angle !== 0) {
    transform.rotate(angle * Math.PI / 180);
  }

  // Apply Flip if required
  if (enabledElement.viewport.hflip) {
    transform.scale(-1, 1);
  }

  if (enabledElement.viewport.vflip) {
    transform.scale(1, -1);
  }

  // Move back from center of image
  transform.translate(-width / 2, -height / 2);

  return transform;
}

/**
 * Rescale the target layer to the base layer based on the
 * relative size of each image and their pixel dimensions.
 *
 * This function will update the Viewport parameters of the
 * target layer to a new scale.
 *
 * @param {EnabledElementLayer} baseLayer The base layer
 * @param {EnabledElementLayer} targetLayer The target layer to rescale
 * @returns {void}
 * @memberof EnabledElementLayers
 */
export function rescaleImage (baseLayer, targetLayer) {
  if (baseLayer.layerId === targetLayer.layerId) {
    throw new Error('rescaleImage: both arguments represent the same layer');
  }

  const baseImage = baseLayer.image;
  const targetImage = targetLayer.image;

  // Return if these images don't have an imageId (e.g. for dynamic images)
  if (!baseImage.imageId || !targetImage.imageId) {
    return;
  }

  // Column pixel spacing need to be considered when calculating the
  // ratio between the layer added and base layer images
  const colRelative = (targetLayer.viewport.displayedArea.columnPixelSpacing * targetImage.width) /
    (baseLayer.viewport.displayedArea.columnPixelSpacing * baseImage.width);
  const viewportRatio = targetLayer.viewport.scale / baseLayer.viewport.scale * colRelative;

  targetLayer.viewport.scale = baseLayer.viewport.scale * viewportRatio;
}

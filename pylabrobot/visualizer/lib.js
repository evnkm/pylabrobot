// ===========================================================================
// Global Color Map (edit this to try new combinations)
// ===========================================================================
const RESOURCE_COLORS = {
  Resource: "#BDB163",
  HamiltonSTARDeck: "#F5FAFC",
  Carrier: "#5C6C8F",
  MFXCarrier: "#536181",
  PlateCarrier: "#5C6C8F",
  TipCarrier: "#64405d",
  TroughCarrier: "#756793",
  TubeCarrier: "#756793",
  Plate: "#3A3A3A",
  Well: "#F5FAFC",
  TipRack: "#8f5c85",
  TubeRack: "#122D42",
  ResourceHolder: "#5B6277",
  PlateHolder: "#8D99AE",
  ContainerBackground: "#E0EAEE",
};

// ===========================================================================
// Mode and Layers
// ===========================================================================

var mode;
const MODE_VISUALIZER = "visualizer";
const MODE_GUI = "gui";

var layer = new Konva.Layer();
var resourceLayer = new Konva.Layer();
var tooltip;
var stage;
var selectedResource;

var canvasWidth, canvasHeight;

var scaleX, scaleY;

var resources = {}; // name -> Resource object

let trash;

let gif;

let resourceImage;

// Used in gif generation
let isRecording = false;
let recordingCounter = 0; // Counter to track the number of recorded frames
var frameImages = [];
let frameInterval = 8;

function getSnappingResourceAndLocationAndSnappingBox(resourceToSnap, x, y) {
  // Return the snapping resource that the given point is within, or undefined if there is no such resource.
  // A snapping resource is a spot within a plate/tip carrier or the OT deck.
  // This can probably be simplified a lot.
  // Returns {resource, location wrt resource}

  if (!snappingEnabled) {
    return undefined;
  }

  // Check if the resource is in the trash.
  if (
    x > trash.x() &&
    x < trash.x() + trash.width() &&
    y > trash.y() &&
    y < trash.y() + trash.height()
  ) {
    return {
      resource: trash,
      location: { x: 0, y: 0 },
      snappingBox: {
        x: trash.x(),
        y: trash.y(),
        width: trash.width(),
        height: trash.height(),
      },
    };
  }

  // Check if the resource is in a ResourceHolder.
  let deck = resources["deck"];
  for (let resource_name in deck.children) {
    const resource = deck.children[resource_name];

    // Check if we have a resource to snap
    let canSnapPlate =
      resourceToSnap.constructor.name === "Plate" &&
      resource.constructor.name === "PlateCarrier";
    let canSnapTipRack =
      resourceToSnap.constructor.name === "TipRack" &&
      resource.constructor.name === "TipCarrier";
    if (!(canSnapPlate || canSnapTipRack)) {
      continue;
    }

    for (let carrier_site_name in resource.children) {
      let carrier_site = resource.children[carrier_site_name];
      const { x: resourceX, y: resourceY } = carrier_site.getAbsoluteLocation();
      if (
        x > resourceX &&
        x < resourceX + carrier_site.size_x &&
        y > resourceY &&
        y < resourceY + carrier_site.size_y
      ) {
        return {
          resource: carrier_site,
          location: { x: 0, y: 0 },
          snappingBox: {
            x: resourceX,
            y: resourceY,
            width: carrier_site.size_x,
            height: carrier_site.size_y,
          },
        };
      }
    }
  }

  // Check if the resource is in the OT Deck.
  if (deck.constructor.name === "OTDeck") {
    const siteWidth = 128.0;
    const siteHeight = 86.0;

    for (let i = 0; i < otDeckSiteLocations.length; i++) {
      let siteLocation = otDeckSiteLocations[i];
      if (
        x > deck.location.x + siteLocation.x &&
        x < deck.location.x + siteLocation.x + siteWidth &&
        y > deck.location.y + siteLocation.y &&
        y < deck.location.y + siteLocation.y + siteHeight
      ) {
        return {
          resource: deck,
          location: { x: siteLocation.x, y: siteLocation.y },
          snappingBox: {
            x: deck.location.x + siteLocation.x,
            y: deck.location.y + siteLocation.y,
            width: siteWidth,
            height: siteHeight,
          },
        };
      }
    }
  }

  // Check if the resource is in an OTDeck.
  return undefined;
}

function getSnappingGrid(x, y, width, height) {
  // Get the snapping lines for the given resource (defined by x, y, width, height).
  // Returns {resourceX, resourceY, snapX, snapY} where resourceX and resourceY are the
  // location where the resource should be snapped to, and snapX and snapY are the
  // snapping lines that should be drawn.

  if (!snappingEnabled) {
    return {};
  }

  const SNAP_MARGIN = 5;

  let snappingLines = {};

  const deck = resources["deck"];
  if (
    deck.constructor.name === "HamiltonSTARDeck" ||
    deck.constructor.name === "VantageDeck"
  ) {
    const railOffset = deck.constructor.name === "VantageDeck" ? 32.5 : 100;

    if (Math.abs(y - deck.location.y - 63) < SNAP_MARGIN) {
      snappingLines.resourceY = deck.location.y + 63;
    }

    if (
      Math.abs(y - deck.location.y - 63 - deck.railHeight + height) <
      SNAP_MARGIN
    ) {
      snappingLines.resourceY = deck.location.y + 63 + deck.railHeight - height;
      snappingLines.snappingY = deck.location.y + 63 + deck.railHeight;
    }

    if (Math.abs(x - deck.location.x) < SNAP_MARGIN) {
      snappingLines.resourceX = deck.location.x;
    }

    for (let rail = 0; rail < deck.num_rails; rail++) {
      const railX = railOffset + 22.5 * rail;
      if (Math.abs(x - railX) < SNAP_MARGIN) {
        snappingLines.resourceX = railX;
      }
    }
  }

  // if resource snapping position defined, but not the snapping line, set the snapping line to the
  // resource snapping position.
  if (
    snappingLines.resourceX !== undefined &&
    snappingLines.snappingX === undefined
  ) {
    snappingLines.snappingX = snappingLines.resourceX;
  }
  if (
    snappingLines.resourceY !== undefined &&
    snappingLines.snappingY === undefined
  ) {
    snappingLines.snappingY = snappingLines.resourceY;
  }

  return snappingLines;
}

class Resource {
  constructor(resourceData, parent = undefined) {
    const { name, location, size_x, size_y, size_z, children } = resourceData;
    this.name = name;
    this.size_x = size_x;
    this.size_y = size_y;
    this.size_z = size_z;
    this.location = location;
    this.parent = parent;

    this.color = "#5B6D8F";

    this.children = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childClass = classForResourceType(child.type);
      const childInstance = new childClass(child, this);
      this.assignChild(childInstance);

      // Save in global lookup
      resources[child.name] = childInstance;
    }
  }

  // Dynamically compute the color based on RESOURCE_COLORS
  getColor() {
    if (RESOURCE_COLORS.hasOwnProperty(this.constructor.name)) {
      return RESOURCE_COLORS[this.constructor.name];
    }
    return RESOURCE_COLORS["Resource"];
  }

  // Properties influenced by mode
  get draggable() {
    return mode === MODE_GUI;
  }
  get canDelete() {
    return mode === MODE_GUI;
  }

  draw(layer) {
    // On draw, destroy the old shape.
    if (this.group !== undefined) {
      this.group.destroy();
    }

    // Add all children to this shape's group.
    this.group = new Konva.Group({
      x: this.location.x,
      y: this.location.y,
      draggable: this.draggable,
    });
    this.mainShape = this.drawMainShape();
    if (this.mainShape !== undefined) {
      this.group.add(this.mainShape);
    }
    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i];
      child.draw(layer);
    }
    layer.add(this.group);
    // Add a reference to this to the shape (so that it may be accessed in event handlers)
    this.group.resource = this;

    // Add this group to parent group.
    if (this.parent !== undefined) {
      this.parent.group.add(this.group);
    }

    // If a shape is drawn, add event handlers and other things.
    if (this.mainShape !== undefined) {
      this.mainShape.resource = this;
      this.mainShape.on("mouseover", () => {
        const { x, y } = this.getAbsoluteLocation();
        if (tooltip !== undefined) {
          tooltip.destroy();
        }
        tooltip = new Konva.Label({
          x: x + this.size_x / 2,
          y: y + this.size_y / 2,
          opacity: 0.75,
        });
        tooltip.add(
          new Konva.Tag({
            fill: "black",
            pointerDirection: "down",
            pointerWidth: 10,
            pointerHeight: 10,
            lineJoin: "round",
            shadowColor: "black",
            shadowBlur: 10,
            shadowOffset: 10,
            shadowOpacity: 0.5,
          })
        );
        tooltip.add(
          new Konva.Text({
            text: this.tooltipLabel(),
            fontFamily: "Arial",
            fontSize: 18,
            padding: 5,
            fill: "white",
          })
        );
        tooltip.scaleY(-1);
        layer.add(tooltip);
      });
      this.mainShape.on("mouseout", () => {
        tooltip.destroy();
      });
    }
  }

  drawMainShape() {
    return new Konva.Rect({
      width: this.size_x,
      height: this.size_y,
      fill: this.getColor(),
      stroke: "black",
      strokeWidth: 1,
    });
  }

  tooltipLabel() {
    return `${this.name} (${this.constructor.name})`;
  }

  getAbsoluteLocation() {
    if (this.parent !== undefined) {
      const parentLocation = this.parent.getAbsoluteLocation();
      return {
        x: parentLocation.x + this.location.x,
        y: parentLocation.y + this.location.y,
        z: parentLocation.z + this.location.z,
      };
    }
    return this.location;
  }

  serialize() {
    const serializedChildren = [];
    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i];
      serializedChildren.push(child.serialize());
    }

    return {
      name: this.name,
      type: this.constructor.name,
      location: {
        ...this.location,
        ...{
          type: "Coordinate",
        },
      },
      size_x: this.size_x,
      size_y: this.size_y,
      size_z: this.size_z,
      children: serializedChildren,
      parent_name: this.parent === undefined ? null : this.parent.name,
    };
  }

  assignChild(child) {
    if (child === this) {
      console.error("Cannot assign a resource to itself", this);
      return;
    }

    // Update layout tree.
    child.parent = this;
    this.children.push(child);

    // Add child group to UI.
    if (this.group !== undefined && child.group !== undefined) {
      this.group.add(child.group);
    }
  }

  unassignChild(child) {
    child.parent = undefined;
    const index = this.children.indexOf(child);
    if (index > -1) {
      this.children.splice(index, 1);
    }
  }

  destroy() {
    // Destroy children
    for (let i = this.children.length - 1; i >= 0; i--) {
      const child = this.children[i];
      child.destroy();
    }

    // Remove from global lookup
    delete resources[this.name];

    // Remove from UI
    if (this.group !== undefined) {
      this.group.destroy();
    }

    // Remove from parent
    if (this.parent !== undefined) {
      this.parent.unassignChild(this);
    }
  }

  update() {
    this.draw(resourceLayer);

    if (isRecording) {
      if (recordingCounter % frameInterval == 0) {
        stageToBlob(stage, handleBlob);
      }
      recordingCounter += 1;
    }
  }

  setState() {}
}

class Deck extends Resource {
  draggable = false;
  canDelete = false;
}

class HamiltonSTARDeck extends Deck {
  constructor(resourceData) {
    super(resourceData, undefined);
    const { num_rails } = resourceData;
    this.num_rails = num_rails;
    this.railHeight = 497;
  }

  drawMainShape() {
    // Draw a transparent rectangle with an outline
    let mainShape = new Konva.Group();
    mainShape.add(
      new Konva.Rect({
        y: 63,
        width: this.size_x,
        height: this.railHeight,
        fill: "white",
        stroke: "black",
        strokeWidth: 1,
      })
    );

    // draw border around the deck
    mainShape.add(
      new Konva.Rect({
        width: this.size_x,
        height: this.size_y,
        stroke: "black",
        strokeWidth: 1,
      })
    );

    // Draw vertical rails as lines
    for (let i = 0; i < this.num_rails; i++) {
      const railBottomTickHeight = 10;
      const rail = new Konva.Line({
        points: [
          100 + i * 22.5, // 22.5 mm per rail
          63 - railBottomTickHeight,
          100 + i * 22.5, // 22.5 mm per rail
          this.railHeight + 63,
        ],
        stroke: "black",
        strokeWidth: 1,
      });
      mainShape.add(rail);

      // Add a text label every 5 rails. Rails are 1-indexed.
      // Keep in mind that the stage is flipped vertically.
      if ((i + 1) % 5 === 0) {
        const railLabel = new Konva.Text({
          x: 100 + i * 22.5, // 22.5 mm per rail
          y: 50,
          text: i + 1,
          fontSize: 12,
          fill: "black",
        });
        railLabel.scaleY(-1); // Flip the text vertically
        mainShape.add(railLabel);
      }
    }
    return mainShape;
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        num_rails: this.num_rails,
        with_trash: false,
        with_trash96: false,
      },
    };
  }
}

class VantageDeck extends Deck {
  constructor(resourceData) {
    super(resourceData, undefined);
    const { size } = resourceData;
    this.size = size;
    if (size === 1.3) {
      this.num_rails = 54;
    } else {
      alert(`Unsupported Vantage Deck size: ${size}. Only 1.3 is supported.`);
      this.num_rails = 0;
    }
    this.railHeight = 497;
  }

  drawMainShape() {
    let mainShape = new Konva.Group();
    mainShape.add(
      new Konva.Rect({
        y: 63,
        width: this.size_x,
        height: this.railHeight,
        fill: "white",
        stroke: "black",
        strokeWidth: 1,
      })
    );

    mainShape.add(
      new Konva.Rect({
        width: this.size_x,
        height: this.size_y,
        stroke: "black",
        strokeWidth: 1,
      })
    );

    for (let i = 0; i < this.num_rails; i++) {
      const railX = 32.5 + i * 22.5;
      const railBottomTickHeight = 10;
      const rail = new Konva.Line({
        points: [railX, 63 - railBottomTickHeight, railX, this.railHeight + 63],
        stroke: "black",
        strokeWidth: 1,
      });
      mainShape.add(rail);

      if ((i + 1) % 5 === 0) {
        const railLabel = new Konva.Text({
          x: railX,
          y: 50,
          text: i + 1,
          fontSize: 12,
          fill: "black",
        });
        railLabel.scaleY(-1);
        mainShape.add(railLabel);
      }
    }
    return mainShape;
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        size: this.size,
      },
    };
  }
}

const otDeckSiteLocations = [
  { x: 0.0, y: 0.0 },
  { x: 132.5, y: 0.0 },
  { x: 265.0, y: 0.0 },
  { x: 0.0, y: 90.5 },
  { x: 132.5, y: 90.5 },
  { x: 265.0, y: 90.5 },
  { x: 0.0, y: 181.0 },
  { x: 132.5, y: 181.0 },
  { x: 265.0, y: 181.0 },
  { x: 0.0, y: 271.5 },
  { x: 132.5, y: 271.5 },
  { x: 265.0, y: 271.5 },
];

class OTDeck extends Deck {
  constructor(resourceData) {
    resourceData.location = { x: 115.65, y: 68.03 };
    super(resourceData, undefined);
  }

  drawMainShape() {
    let group = new Konva.Group({});
    const width = 128.0;
    const height = 86.0;
    // Draw the sites
    for (let i = 0; i < otDeckSiteLocations.length; i++) {
      const siteLocation = otDeckSiteLocations[i];
      const site = new Konva.Rect({
        x: siteLocation.x,
        y: siteLocation.y,
        width: width,
        height: height,
        fill: "white",
        stroke: "black",
        strokeWidth: 1,
      });
      group.add(site);

      // Add a text label in the site
      const siteLabel = new Konva.Text({
        x: siteLocation.x,
        y: siteLocation.y + height,
        text: i + 1,
        width: width,
        height: height,
        fontSize: 16,
        fill: "black",
        align: "center",
        verticalAlign: "middle",
        scaleY: -1, // Flip the text vertically
      });
      group.add(siteLabel);
    }

    // draw border around the deck
    group.add(
      new Konva.Rect({
        width: this.size_x,
        height: this.size_y,
        stroke: "black",
        strokeWidth: 1,
      })
    );

    return group;
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        with_trash: false,
      },
    };
  }
}

let snapLines = [];
let snappingBox = undefined;

class Plate extends Resource {
  constructor(resourceData, parent = undefined) {
    super(resourceData, parent);
    const { num_items_x, num_items_y } = resourceData;
    this.num_items_x = num_items_x;
    this.num_items_y = num_items_y;
  }

  drawMainShape() {
    return new Konva.Rect({
      width: this.size_x,
      height: this.size_y,
      fill: this.getColor(),
      stroke: "black",
      strokeWidth: 1,
    });
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        num_items_x: this.num_items_x,
        num_items_y: this.num_items_y,
      },
    };
  }

  update() {
    super.update();

    // Rename the children
    for (let i = 0; i < this.num_items_x; i++) {
      for (let j = 0; j < this.num_items_y; j++) {
        const child = this.children[i * this.num_items_y + j];
        child.name = `${this.name}_well_${i}_${j}`;
      }
    }
  }
}

class Container extends Resource {
  constructor(resourceData, parent) {
    super(resourceData, parent);
    const { max_volume } = resourceData;
    this.maxVolume = max_volume;
    this.liquids = resourceData.liquids || [];
  }

  static colorForVolume(volume, maxVolume) {
    return `rgba(239, 35, 60, ${volume / maxVolume})`;
  }

  static colorForLiquid(liquidName, alpha = 1.0) {
    const baseColor = getColorForLiquid(liquidName);
    // Extract RGB components from hex color
    const r = parseInt(baseColor.slice(1, 3), 16);
    const g = parseInt(baseColor.slice(3, 5), 16);
    const b = parseInt(baseColor.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  getVolume() {
    return this.liquids.reduce((acc, liquid) => acc + liquid.volume, 0);
  }

  getLiquidName() {
    // Get the name of the predominant liquid
    if (this.liquids.length === 0) return null;

    // Find the liquid with the largest volume
    let maxVolumeIndex = 0;
    for (let i = 1; i < this.liquids.length; i++) {
      if (this.liquids[i].volume > this.liquids[maxVolumeIndex].volume) {
        maxVolumeIndex = i;
      }
    }

    return this.liquids[maxVolumeIndex].name;
  }

  aspirate(volume) {
    if (volume > this.getVolume()) {
      throw new Error(
        `Aspirating ${volume}uL from well ${
          this.name
        } with ${this.getVolume()}uL`
      );
    }

    // Remove liquids top down until we have removed the desired volume.
    let volumeToRemove = volume;
    for (let i = this.liquids.length - 1; i >= 0; i--) {
      const liquid = this.liquids[i];
      if (volumeToRemove >= liquid.volume) {
        volumeToRemove -= liquid.volume;
        this.liquids.splice(i, 1);
      } else {
        liquid.volume -= volumeToRemove;
        volumeToRemove = 0;
      }
    }

    this.update();
  }

  addLiquid(liquid) {
    this.liquids.push(liquid);
    this.update();
  }

  setLiquids(liquids) {
    this.liquids = liquids;
    this.update();
  }

  setState(state) {
    let liquids = [];
    for (let i = 0; i < state.liquids.length; i++) {
      const liquid = state.liquids[i];
      liquids.push({
        name: liquid[0],
        volume: liquid[1],
      });
    }
    this.setLiquids(liquids);
  }

  serializeState() {
    return {
      liquids: this.liquids,
      pending_liquids: this.liquids,
    };
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        max_volume: this.maxVolume,
      },
    };
  }
}

class Trough extends Container {
  drawMainShape() {
    let mainShape = new Konva.Group();
    const fillRatio = this.getVolume() / this.maxVolume;
    const liquidColor = this.getLiquidName();

    // Background container
    let background = new Konva.Rect({
      width: this.size_x,
      height: this.size_y,
      fill: "white",
      stroke: "black",
      strokeWidth: 1,
    });

    // Liquid fill - height based on volume
    if (fillRatio > 0) {
      let liquidHeight = fillRatio * this.size_y;
      let liquidY = this.size_y - liquidHeight; // Start from bottom

      let liquidLayer = new Konva.Rect({
        x: 0,
        y: liquidY,
        width: this.size_x,
        height: liquidHeight,
        fill: Container.colorForLiquid(liquidColor),
        stroke: "black",
        strokeWidth: 0.5,
      });

      mainShape.add(background);
      mainShape.add(liquidLayer);
    } else {
      mainShape.add(background);
    }

    return mainShape;
  }
}

class Well extends Container {
  get draggable() {
    return false;
  }
  get canDelete() {
    return false;
  }

  constructor(resourceData, parent) {
    super(resourceData, parent);
    const { cross_section_type } = resourceData;
    this.cross_section_type = cross_section_type;
  }

  drawMainShape() {
    const fillRatio = this.getVolume() / this.maxVolume;
    const liquidColor = this.getLiquidName();

    if (this.cross_section_type === "circle") {
      // For circular wells, we'll use a group with a background circle and a liquid circle
      let wellGroup = new Konva.Group();

      // Background circle
      let background = new Konva.Circle({
        radius: this.size_x / 2,
        fill: "white",
        stroke: "black",
        strokeWidth: 1,
        offsetX: -this.size_x / 2,
        offsetY: -this.size_y / 2,
      });

      wellGroup.add(background);

      // Only draw liquid if there is some
      if (fillRatio > 0) {
        let liquidRadius = (this.size_x / 2) * Math.sqrt(fillRatio);

        let liquid = new Konva.Circle({
          radius: liquidRadius,
          fill: Container.colorForLiquid(liquidColor),
          stroke: "black",
          strokeWidth: 0.5,
          offsetX: -this.size_x / 2,
          offsetY: -this.size_y / 2,
        });

        wellGroup.add(liquid);
      }

      return wellGroup;
    } else {
      // For rectangular wells, we'll use a group with a background rectangle and a liquid rectangle
      let wellGroup = new Konva.Group();

      // Background rectangle
      let background = new Konva.Rect({
        width: this.size_x,
        height: this.size_y,
        fill: "white",
        stroke: "black",
        strokeWidth: 1,
      });

      wellGroup.add(background);

      // Only draw liquid if there is some
      if (fillRatio > 0) {
        let liquidHeight = fillRatio * this.size_y;
        let liquidY = this.size_y - liquidHeight; // Start from bottom

        let liquid = new Konva.Rect({
          x: 0,
          y: liquidY,
          width: this.size_x,
          height: liquidHeight,
          fill: Container.colorForLiquid(liquidColor),
          stroke: "black",
          strokeWidth: 0.5,
        });

        wellGroup.add(liquid);
      }

      return wellGroup;
    }
    return mainShape;
  }
}

class Trough extends Container {
  drawMainShape() {
    const group = new Konva.Group();
    group.add(
      new Konva.Rect({
        // background
        width: this.size_x,
        height: this.size_y,
        fill: RESOURCE_COLORS["ContainerBackground"],
        stroke: "black",
        strokeWidth: 1,
      })
    );
    group.add(
      new Konva.Rect({
        // liquid layer
        width: this.size_x,
        height: this.size_y,
        fill: Trough.colorForVolume(this.getVolume(), this.maxVolume),
      })
    );
    return group;
  }
}

class TipRack extends Resource {
  constructor(resourceData, parent) {
    super(resourceData, parent);
    const { num_items_x, num_items_y } = resourceData;
    this.num_items_x = num_items_x;
    this.num_items_y = num_items_y;
  }

  drawMainShape() {
    return new Konva.Rect({
      width: this.size_x,
      height: this.size_y,
      fill: this.getColor(),
      stroke: "black",
      strokeWidth: 1,
    });
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        num_items_x: this.num_items_x,
        num_items_y: this.num_items_y,
      },
    };
  }

  update() {
    super.update();

    // Rename the children
    for (let i = 0; i < this.num_items_x; i++) {
      for (let j = 0; j < this.num_items_y; j++) {
        const child = this.children[i * this.num_items_y + j];
        child.name = `${this.name}_tipspot_${i}_${j}`;
      }
    }
  }
}

class TipSpot extends Resource {
  constructor(resourceData, parent) {
    super(resourceData, parent);
    this.has_tip = false;
    this.tip = resourceData.prototype_tip; // not really a creator, but good enough for now.
  }

  get draggable() {
    return false;
  }
  get canDelete() {
    return false;
  }

  drawMainShape() {
    return new Konva.Circle({
      radius: this.size_x / 2,
      fill: this.has_tip ? "#40CDA1" : "white",
      stroke: "black",
      strokeWidth: 1,
      offsetX: -this.size_x / 2,
      offsetY: -this.size_y / 2,
    });
  }

  setState(state) {
    this.has_tip = state.tip !== null;
    this.update();
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        prototype_tip: this.tip,
      },
    };
  }

  serializeState() {
    if (this.has_tip) {
      return {
        tip: this.tip,
        pending_tip: this.tip,
      };
    }
    return {
      tip: null,
      pending_tip: null,
    };
  }
}

class Tube extends Container {
  get draggable() {
    return false;
  }
  get canDelete() {
    return false;
  }

  constructor(resourceData, parent) {
    super(resourceData, parent);
  }

  drawMainShape() {
    const mainShape = new Konva.Group();
    mainShape.add(
      new Konva.Circle({
        // background
        radius: this.size_x / 2,
        fill: RESOURCE_COLORS["ContainerBackground"],
        offsetX: -this.size_x / 2,
        offsetY: -this.size_y / 2,
      })
    );
    mainShape.add(
      new Konva.Circle({
        // liquid
        radius: this.size_x / 2,
        fill: Tube.colorForVolume(this.getVolume(), this.maxVolume),
        stroke: "black",
        strokeWidth: 1,
        offsetX: -this.size_x / 2,
        offsetY: -this.size_y / 2,
      })
    );
    return mainShape;
  }
}

// Nothing special.
class Trash extends Resource {
  drawMainShape() {
    if (resources["deck"].constructor.name) {
      return undefined;
    }
    return super.drawMainShape();
  }
}

class Carrier extends Resource {}
class MFXCarrier extends Carrier {}
class PlateCarrier extends Carrier {}
class TipCarrier extends Carrier {}
class TroughCarrier extends Carrier {}
class TubeCarrier extends Carrier {}

class ResourceHolder extends Resource {
  constructor(resourceData, parent) {
    super(resourceData, parent);
    const { spot } = resourceData;
    this.spot = spot;
  }

  draggable = false;
  canDelete = false;

  serialize() {
    return {
      ...super.serialize(),
      ...{
        spot: this.spot,
      },
    };
  }
}

class TubeRack extends Resource {
  constructor(resourceData, parent = undefined) {
    super(resourceData, parent);
    const { num_items_x, num_items_y } = resourceData;
    this.num_items_x = num_items_x;
    this.num_items_y = num_items_y;
  }

  drawMainShape() {
    return new Konva.Rect({
      width: this.size_x,
      height: this.size_y,
      fill: this.getColor(),
      stroke: "black",
      strokeWidth: 1,
    });
  }

  serialize() {
    return {
      ...super.serialize(),
      ...{
        num_items_x: this.num_items_x,
        num_items_y: this.num_items_y,
      },
    };
  }

  update() {
    super.update();

    // Rename the children
    for (let i = 0; i < this.num_items_x; i++) {
      for (let j = 0; j < this.num_items_y; j++) {
        const child = this.children[i * this.num_items_y + j];
        child.name = `${this.name}_tube_${i}_${j}`;
      }
    }
  }
}

class Tube extends Container {
  draggable = false;
  canDelete = false;

  constructor(resourceData, parent) {
    super(resourceData, parent);
  }

  drawMainShape() {
    const fillRatio = this.getVolume() / this.maxVolume;
    const liquidColor = this.getLiquidName();

    // Create a group that will contain both the tube outline and liquid fill
    let tubeGroup = new Konva.Group();

    // Tube outline
    let tubeOutline = new Konva.Circle({
      radius: (1.25 * this.size_x) / 2,
      fill: "white",
      stroke: "black",
      strokeWidth: 1,
      offsetX: -this.size_x / 2,
      offsetY: -this.size_y / 2,
    });

    tubeGroup.add(tubeOutline);

    // Only draw liquid if there is some
    if (fillRatio > 0) {
      let liquidRadius = ((1.25 * this.size_x) / 2) * Math.sqrt(fillRatio);

      let liquid = new Konva.Circle({
        radius: liquidRadius,
        fill: Container.colorForLiquid(liquidColor),
        stroke: "black",
        strokeWidth: 0.5,
        offsetX: -this.size_x / 2,
        offsetY: -this.size_y / 2,
      });

      tubeGroup.add(liquid);
    }

    return tubeGroup;
  }
}

class LiquidHandler extends Resource {
  drawMainShape() {
    return undefined; // just draw the children (deck and so on)
  }
}

// Create a global color mapping for liquid names
// This will ensure consistent colors across different containers
const liquidColorMap = {};
const predefinedColors = [
  "#FF5733", // Reddish orange
  "#33FF57", // Green
  "#3357FF", // Blue
  "#FF33F5", // Pink
  "#FFD433", // Yellow
  "#33FFF5", // Cyan
  "#D433FF", // Purple
  "#FF8F33", // Orange
  "#8FFF33", // Lime green
  "#338FFF", // Light blue
  "#FF33A1", // Magenta
  "#A1FF33", // Light green
];
let colorIndex = 0;

function getColorForLiquid(liquidName) {
  if (!liquidName || liquidName === "Unknown liquid" || liquidName === "None") {
    return "#FF5733"; // Default red color for unknown liquids
  }

  if (!liquidColorMap[liquidName]) {
    // Assign a new color from the predefined list, or cycle through them
    liquidColorMap[liquidName] =
      predefinedColors[colorIndex % predefinedColors.length];
    colorIndex++;
  }

  return liquidColorMap[liquidName];
}

function classForResourceType(type) {
  switch (type) {
    case "Deck":
      return Deck;
    case ("HamiltonDeck", "HamiltonSTARDeck"):
      return HamiltonSTARDeck;
    case "Trash":
      return Trash;
    case "OTDeck":
      return OTDeck;
    case "Plate":
      return Plate;
    case "Well":
      return Well;
    case "TipRack":
      return TipRack;
    case "TipSpot":
      return TipSpot;
    case "ResourceHolder":
      return ResourceHolder;
    case "PlateHolder":
      return PlateHolder;
    case "Carrier":
      return Carrier;
    case "PlateCarrier":
      return PlateCarrier;
    case "TipCarrier":
      return TipCarrier;
    case "TroughCarrier":
      return TroughCarrier;
    case "TubeCarrier":
      return TubeCarrier;
    case "MFXCarrier":
      return Carrier;
    case "Container":
      return Container;
    case "Trough":
      return Trough;
    case "VantageDeck":
      return VantageDeck;
    case "LiquidHandler":
      return LiquidHandler;
    case "TubeRack":
      return TubeRack;
    case "Tube":
      return Tube;
    default:
      return Resource;
  }
}

function loadResource(resourceData) {
  const resourceClass = classForResourceType(resourceData.type);

  const parentName = resourceData.parent_name;
  var parent = undefined;
  if (parentName !== undefined) {
    parent = resources[parentName];
  }

  const resource = new resourceClass(resourceData, parent);
  resources[resource.name] = resource;

  return resource;
}

// ===========================================================================
// init
// ===========================================================================

window.addEventListener("load", function () {
  const canvas = document.getElementById("kanvas");
  canvasWidth = canvas.offsetWidth;
  canvasHeight = canvas.offsetHeight;

  stage = new Konva.Stage({
    container: "kanvas",
    width: canvasWidth,
    height: canvasHeight,
    draggable: true,
  });
  stage.scaleY(-1);
  stage.offsetY(canvasHeight);

  let minX = -(1 / 2) * canvasWidth;
  let minY = -(1 / 2) * canvasHeight;
  let maxX = (1 / 2) * canvasWidth;
  let maxY = (1 / 2) * canvasHeight;

  // limit draggable area to size of canvas
  stage.dragBoundFunc(function (pos) {
    // Set the bounds of the draggable area to 1/2 off the canvas.
    let newX = Math.max(minX, Math.min(maxX, pos.x));
    let newY = Math.max(minY, Math.min(maxY, pos.y));

    return {
      x: newX,
      y: newY,
    };
  });

  // add white background
  var background = new Konva.Rect({
    x: minX,
    y: minY,
    width: canvasWidth - minX + maxX,
    height: canvasHeight - minY + maxY,
    fill: "white",
    listening: false,
  });

  // add the layer to the stage
  stage.add(layer);
  stage.add(resourceLayer);

  layer.add(background);

  // Check if there is an after stage setup callback, and if so, call it.
  if (typeof afterStageSetup === "function") {
    afterStageSetup();
  }
});

function gifResetUI() {
  document.getElementById("gif-start").hidden = true;
  document.getElementById("gif-recording").hidden = true;
  document.getElementById("gif-processing").hidden = true;
  document.getElementById("gif-download").hidden = true;
}

function gifShowStartUI() {
  document.getElementById("gif-start").hidden = false;
}

function gifShowRecordingUI() {
  document.getElementById("gif-recording").hidden = false;
}

function gifShowProcessingUI() {
  document.getElementById("gif-processing").hidden = false;
}

function gifShowDownloadUI() {
  document.getElementById("gif-download").hidden = false;
}

async function startRecording() {
  // Turn recording on
  isRecording = true;

  // Reset saved frames buffer
  frameImages = [];

  // Reset the render progress
  var info = document.getElementById("progressBar");
  info.innerText = " GIF Rendering Progress: " + Math.round(0 * 100) + "%";

  stageToBlob(stage, handleBlob);

  gifResetUI();
  gifShowRecordingUI();
}

function stopRecording() {
  gifResetUI();
  gifShowProcessingUI();

  // Turn recording off
  isRecording = false;

  // Render the final image
  // Do it twice bc it looks better

  stageToBlob(stage, handleBlob);
  stageToBlob(stage, handleBlob);

  gif = new GIF({
    workers: 10,
    workerScript: "gif.worker.js",
    background: "#FFFFFF",
    width: stage.width(),
    height: stage.height(),
  });

  // Add each frame to the GIF
  for (var i = 0; i < frameImages.length; i++) {
    gif.addFrame(frameImages[i], { delay: 1 });
  }

  // Add progress bar based on how much the gif is rendered
  gif.on("progress", function (p) {
    var info = document.getElementById("progressBar");
    info.innerText = " GIF Rendering Progress: " + Math.round(p * 100) + "%";
  });

  // Load gif into right portion of screen
  gif.on("finished", function (blob) {
    renderedGifBlob = blob;
    gifResetUI();
    gifShowDownloadUI();
    gifShowStartUI();
  });

  gif.render();
}

// convert stage to a blob and handle the blob
function stageToBlob(stage, callback) {
  stage.toBlob({
    callback: callback,
    mimeType: "image/jpg",
    quality: 0.3,
  });
}

// handle the blob (e.g., create an Image element and add it to frameImages)
function handleBlob(blob) {
  const url = URL.createObjectURL(blob);
  const myImg = new Image();

  myImg.src = url;
  myImg.width = stage.width();
  myImg.height = stage.height();

  frameImages.push(myImg);

  myImg.onload = function () {
    URL.revokeObjectURL(url); // Free up memory
  };
}

// Set up event listeners for the buttons
document
  .getElementById("start-recording-button")
  .addEventListener("click", startRecording);

document
  .getElementById("stop-recording-button")
  .addEventListener("click", stopRecording);

document
  .getElementById("gif-download-button")
  .addEventListener("click", function () {
    if (!renderedGifBlob) {
      alert("No GIF rendered yet. Please stop the recording first.");
      return;
    }

    var fileName =
      document.getElementById("fileName").value || "plr-visualizer";
    var url = URL.createObjectURL(renderedGifBlob);
    var a = document.createElement("a");
    a.href = url;
    if (!fileName.endsWith(".gif")) {
      fileName += ".gif";
    }
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

document
  .getElementById("gif-frame-rate")
  .addEventListener("input", function () {
    let value = parseInt(this.value);
    // Adjust the value to the nearest multiple of 8
    value = Math.round(value / 8) * 8;
    // Ensure the value stays within the allowed range
    if (value < 1) value = 1;
    if (value > 96) value = 96;

    this.value = value; // Update the slider value
    document.getElementById("current-value").textContent =
      "Frame Save Interval: " + value;

    frameInterval = value;
  });

window.addEventListener("load", function () {
  gifResetUI();
  gifShowStartUI();
});

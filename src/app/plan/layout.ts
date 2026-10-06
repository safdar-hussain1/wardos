/**
 * Geometry for the floor plan: where every bed, wall, door and floor line
 * sits, in SVG user units. Pure data, no React, so it can be tested on its
 * own (every bed placed once, inside its ward, nothing overlapping).
 *
 * Two variants share one drawing vocabulary: "wide" is the architect's
 * sheet for desktop (north wing, corridor, south wing, the coloured floor
 * lines running from reception to each ward), "tall" stacks the wards for a
 * phone. Beds are placed in label order (G-01 ... G-14), so the seed's bed
 * ids never matter.
 */

export type WardKey = 'GENERAL' | 'TWIN' | 'PRIVATE' | 'ICU'
export type Variant = 'wide' | 'tall'

export interface PlanBedInput {
  id: number
  label: string
  ward: string
}

export interface BedBox {
  id: number
  label: string
  ward: WardKey
  x: number
  y: number
  w: number
  h: number
  /** Which short end the pillow is at. */
  head: 'top' | 'bottom'
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Plate extends Rect {
  ward: WardKey
  text: string
}

export interface Door {
  /** Hinge point. */
  x: number
  y: number
  /** Leaf length. */
  r: number
  /** The quarter the leaf swings through: sx/sy are the signs of the swing direction. */
  sx: 1 | -1
  sy: 1 | -1
}

export interface Label {
  x: number
  y: number
  text: string
  anchor: 'start' | 'middle' | 'end'
  tone: 'fixture' | 'note'
}

export interface FloorLine {
  ward: WardKey
  points: [number, number][]
}

export interface AmbulanceSlot extends Rect {
  index: number
}

export interface PlanLayout {
  variant: Variant
  width: number
  height: number
  building: Rect
  zones: (Rect & { ward: WardKey })[]
  corridors: Rect[]
  /** Wall segments [x1, y1, x2, y2]; door openings are simply gaps between segments. */
  walls: [number, number, number, number][]
  outerWalls: [number, number, number, number][]
  glass: [number, number, number, number][]
  curtains: [number, number, number, number][]
  doors: Door[]
  beds: BedBox[]
  plates: Plate[]
  lines: FloorLine[]
  fixtures: { kind: 'desk' | 'station'; d: string }[]
  labels: Label[]
  ambulanceBay: Rect
  ambulanceSlots: AmbulanceSlot[]
}

export const WARD_ORDER: WardKey[] = ['GENERAL', 'TWIN', 'PRIVATE', 'ICU']

export const WARD_PLATE_TEXT: Record<WardKey, string> = {
  GENERAL: 'General ward',
  TWIN: 'Twin sharing',
  PRIVATE: 'Private rooms',
  ICU: 'Intensive care',
}

function isWard(w: string): w is WardKey {
  return w === 'GENERAL' || w === 'TWIN' || w === 'PRIVATE' || w === 'ICU'
}

/** The ward's beds in label order (G-01 before G-02), whatever their database ids. */
function bedsOf(beds: PlanBedInput[], ward: WardKey): PlanBedInput[] {
  return beds
    .filter((b) => b.ward === ward)
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
}

function place(
  input: PlanBedInput,
  ward: WardKey,
  x: number,
  y: number,
  w: number,
  h: number,
  head: 'top' | 'bottom',
): BedBox {
  return { id: input.id, label: input.label, ward, x, y, w, h, head }
}

/** Width of a plate for its text at the plan's plate font size (generous: Atkinson is wide). */
function plateWidth(text: string, fontSize: number): number {
  return Math.round(text.length * fontSize * 0.6 + 34)
}

// ---------------------------------------------------------------------------
// wide: the desktop sheet, 1000 x 610
// ---------------------------------------------------------------------------

function wideLayout(beds: PlanBedInput[]): PlanLayout {
  const BW = 42
  const BH = 68
  const top = 16
  const left = 16
  const right = 984
  const northBottom = 240 // corridor's north wall
  const southTop = 304 // corridor's south wall
  const bayTop = 404 // front of the south wing's bays
  const bottom = 500
  const westEnd = 596 // General | ICU
  const lobbyWest = 436
  const lobbyEast = 564

  const out: BedBox[] = []

  // General ward: an open ward, seven beds along each long wall.
  const general = bedsOf(beds, 'GENERAL')
  const gStep = 78
  const gStart = 70
  general.forEach((b, i) => {
    const col = i % 7
    const row = Math.floor(i / 7)
    const x = gStart + col * gStep
    out.push(row === 0 ? place(b, 'GENERAL', x, top + 14, BW, BH, 'top') : place(b, 'GENERAL', x, northBottom - 10 - BH, BW, BH, 'bottom'))
  })

  // Intensive care: four glass bays along the north wall, a nurses' station in front.
  const icu = bedsOf(beds, 'ICU')
  const bayW = 82
  const bayGap = 6
  const icuStart = westEnd + Math.round((right - westEnd - (4 * bayW + 3 * bayGap)) / 2)
  icu.forEach((b, i) => {
    const bx = icuStart + i * (bayW + bayGap)
    out.push(place(b, 'ICU', bx + (bayW - BW) / 2, top + 12, BW, BH, 'top'))
  })

  // Twin sharing: four bays of two beds, heads to the south wall.
  const twin = bedsOf(beds, 'TWIN')
  const twinBayW = (lobbyWest - left) / 4
  twin.forEach((b, i) => {
    const bay = Math.floor(i / 2)
    const seat = i % 2
    const bx = left + bay * twinBayW
    out.push(place(b, 'TWIN', bx + 7 + seat * (BW + 7), bottom - 10 - BH, BW, BH, 'bottom'))
  })

  // Private rooms: six single rooms, heads to the south wall.
  const priv = bedsOf(beds, 'PRIVATE')
  const roomW = (right - lobbyEast) / 6
  priv.forEach((b, i) => {
    const rx = lobbyEast + i * roomW
    out.push(place(b, 'PRIVATE', rx + (roomW - BW) / 2, bottom - 10 - BH, BW, BH, 'bottom'))
  })

  // Walls. Door openings are the gaps.
  const gDoor = [24, 58] // General's door, west end of its south wall
  const iDoor = [940, 974] // ICU's door, east end of its south wall
  const tDoor = [204, 240] // Twin sharing's entrance from the corridor
  const pDoor = [760, 796] // Private rooms' entrance from the corridor
  const walls: [number, number, number, number][] = [
    // north wing / corridor
    [left, northBottom, gDoor[0], northBottom],
    [gDoor[1], northBottom, iDoor[0], northBottom],
    [iDoor[1], northBottom, right, northBottom],
    [westEnd, top, westEnd, northBottom],
    // corridor / south wing (the lobby is open to the corridor)
    [left, southTop, tDoor[0], southTop],
    [tDoor[1], southTop, lobbyWest, southTop],
    [lobbyEast, southTop, pDoor[0], southTop],
    [pDoor[1], southTop, right, southTop],
    [lobbyWest, southTop, lobbyWest, bottom],
    [lobbyEast, southTop, lobbyEast, bottom],
  ]
  // bay and room partitions in the south wing
  for (let i = 1; i < 4; i++) walls.push([left + i * twinBayW, bayTop, left + i * twinBayW, bottom])
  for (let i = 1; i < 6; i++) walls.push([lobbyEast + i * roomW, bayTop, lobbyEast + i * roomW, bottom])
  // private rooms are closed rooms: a front wall with a door gap for each
  for (let i = 0; i < 6; i++) {
    const rx = lobbyEast + i * roomW
    walls.push([rx, bayTop, rx + 8, bayTop], [rx + 38, bayTop, rx + roomW, bayTop])
  }

  const entrance = [474, 526] // main entrance, south wall of the lobby
  const outerWalls: [number, number, number, number][] = [
    [left, top, right, top],
    [right, top, right, bottom],
    [right, bottom, entrance[1], bottom],
    [entrance[0], bottom, left, bottom],
    [left, bottom, left, top],
  ]

  // ICU glass partitions between bays
  const glass: [number, number, number, number][] = []
  for (let i = 0; i <= 4; i++) {
    const gx = icuStart + i * (bayW + bayGap) - bayGap / 2
    glass.push([gx, top, gx, top + 112])
  }

  // Curtain rails: between General beds, between each Twin pair, and the Twin bay fronts.
  const curtains: [number, number, number, number][] = []
  for (let col = 0; col < 6; col++) {
    const cx = gStart + col * gStep + BW + (gStep - BW) / 2
    curtains.push([cx, top + 6, cx, top + 14 + BH + 8], [cx, northBottom - 18 - BH, cx, northBottom - 6])
  }
  for (let bay = 0; bay < 4; bay++) {
    const mid = left + bay * twinBayW + 7 + BW + 3.5
    curtains.push([mid, bayTop + 10, mid, bottom - 6])
    curtains.push([left + bay * twinBayW + 4, bayTop, left + (bay + 1) * twinBayW - 4, bayTop])
  }

  const doors: Door[] = [
    { x: gDoor[1], y: northBottom, r: gDoor[1] - gDoor[0], sx: -1, sy: -1 },
    { x: iDoor[0], y: northBottom, r: iDoor[1] - iDoor[0], sx: 1, sy: -1 },
    { x: tDoor[0], y: southTop, r: tDoor[1] - tDoor[0], sx: 1, sy: 1 },
    { x: pDoor[1], y: southTop, r: pDoor[1] - pDoor[0], sx: -1, sy: 1 },
    { x: entrance[0], y: bottom, r: (entrance[1] - entrance[0]) / 2, sx: 1, sy: -1 },
    { x: entrance[1], y: bottom, r: (entrance[1] - entrance[0]) / 2, sx: -1, sy: -1 },
  ]
  for (let i = 0; i < 6; i++) {
    const rx = lobbyEast + i * roomW
    doors.push({ x: rx + 8, y: bayTop, r: 30, sx: 1, sy: 1 })
  }

  // Floor lines: from the reception desk to each ward's door, the way
  // hospitals paint them. Verticals are ordered west to east so no two cross.
  const startY = 408
  const north = 254
  const south = 290
  const lines: FloorLine[] = [
    { ward: 'TWIN', points: [[480, startY], [480, south], [(tDoor[0] + tDoor[1]) / 2, south], [(tDoor[0] + tDoor[1]) / 2, southTop + 22]] },
    { ward: 'GENERAL', points: [[492, startY], [492, north], [(gDoor[0] + gDoor[1]) / 2, north], [(gDoor[0] + gDoor[1]) / 2, northBottom - 22]] },
    { ward: 'ICU', points: [[508, startY], [508, north], [(iDoor[0] + iDoor[1]) / 2, north], [(iDoor[0] + iDoor[1]) / 2, northBottom - 22]] },
    { ward: 'PRIVATE', points: [[520, startY], [520, south], [(pDoor[0] + pDoor[1]) / 2, south], [(pDoor[0] + pDoor[1]) / 2, southTop + 22]] },
  ]

  const fs = 12
  const plate = (ward: WardKey, x: number, y: number): Plate => {
    const text = WARD_PLATE_TEXT[ward]
    return { ward, text, x, y, w: plateWidth(text, fs), h: 24 }
  }
  const plates: Plate[] = [
    plate('GENERAL', gStart, 118),
    plate('ICU', 846, 146),
    plate('TWIN', 252, 330),
    plate('PRIVATE', 812, 330),
  ]

  const desk = `M ${452} ${418} Q ${500} ${436} ${548} ${418} L ${548} ${428} Q ${500} ${446} ${452} ${428} Z`
  const stationCx = 744
  const station = `M ${stationCx - 84} ${168} Q ${stationCx} ${198} ${stationCx + 84} ${168} L ${stationCx + 84} ${180} Q ${stationCx} ${210} ${stationCx - 84} ${180} Z`

  const bay = { x: 600, y: 520, w: right - 600, h: 82 }
  const slotW = 84
  const ambulanceSlots: AmbulanceSlot[] = [0, 1, 2, 3].map((i) => ({
    index: i,
    x: bay.x + 18 + i * (slotW + 10),
    y: bay.y + 16,
    w: slotW,
    h: 58,
  }))

  return {
    variant: 'wide',
    width: 1000,
    height: 610,
    building: { x: left, y: top, w: right - left, h: bottom - top },
    zones: [
      { ward: 'GENERAL', x: left, y: top, w: westEnd - left, h: northBottom - top },
      { ward: 'ICU', x: westEnd, y: top, w: right - westEnd, h: northBottom - top },
      { ward: 'TWIN', x: left, y: southTop, w: lobbyWest - left, h: bottom - southTop },
      { ward: 'PRIVATE', x: lobbyEast, y: southTop, w: right - lobbyEast, h: bottom - southTop },
    ],
    corridors: [
      { x: left, y: northBottom, w: right - left, h: southTop - northBottom },
      { x: lobbyWest, y: southTop, w: lobbyEast - lobbyWest, h: bottom - southTop },
    ],
    walls,
    outerWalls,
    glass,
    curtains,
    doors,
    beds: out,
    plates,
    lines,
    fixtures: [
      { kind: 'desk', d: desk },
      { kind: 'station', d: station },
    ],
    labels: [
      { x: 500, y: 462, text: 'Reception', anchor: 'middle', tone: 'fixture' },
      { x: stationCx, y: 228, text: 'Nurses’ station', anchor: 'middle', tone: 'fixture' },
      { x: 500, y: 532, text: 'Main entrance', anchor: 'middle', tone: 'note' },
      { x: bay.x + 18, y: bay.y + 6, text: 'Ambulance bay', anchor: 'start', tone: 'note' },
    ],
    ambulanceBay: bay,
    ambulanceSlots,
  }
}

// ---------------------------------------------------------------------------
// tall: the phone sheet, 400 wide, wards stacked
// ---------------------------------------------------------------------------

function tallLayout(beds: PlanBedInput[]): PlanLayout {
  const BW = 38
  const BH = 60
  const left = 8
  const right = 392
  const out: BedBox[] = []
  const walls: [number, number, number, number][] = []
  const curtains: [number, number, number, number][] = []
  const glass: [number, number, number, number][] = []
  const doors: Door[] = []
  const plates: Plate[] = []
  const zones: (Rect & { ward: WardKey })[] = []
  const fs = 12
  const plate = (ward: WardKey, x: number, y: number): Plate => {
    const text = WARD_PLATE_TEXT[ward]
    return { ward, text, x, y, w: plateWidth(text, fs), h: 24 }
  }

  // General: two rows of seven.
  let y0 = 8
  const gH = 214
  zones.push({ ward: 'GENERAL', x: left, y: y0, w: right - left, h: gH })
  const gStep = 52
  const gStart = left + Math.round((right - left - (7 * BW + 6 * (gStep - BW))) / 2)
  bedsOf(beds, 'GENERAL').forEach((b, i) => {
    const col = i % 7
    const row = Math.floor(i / 7)
    const x = gStart + col * gStep
    out.push(row === 0 ? place(b, 'GENERAL', x, y0 + 12, BW, BH, 'top') : place(b, 'GENERAL', x, y0 + gH - 12 - BH, BW, BH, 'bottom'))
  })
  for (let col = 0; col < 6; col++) {
    const cx = gStart + col * gStep + BW + (gStep - BW) / 2
    curtains.push([cx, y0 + 4, cx, y0 + 12 + BH + 6], [cx, y0 + gH - 18 - BH, cx, y0 + gH - 4])
  }
  plates.push(plate('GENERAL', gStart, y0 + gH / 2 - 12))
  walls.push([left, y0 + gH, right, y0 + gH])

  // ICU: four glass bays and the station.
  y0 += gH
  const iH = 168
  zones.push({ ward: 'ICU', x: left, y: y0, w: right - left, h: iH })
  const bayW = 88
  const bayGap = 6
  const iStart = left + Math.round((right - left - (4 * bayW + 3 * bayGap)) / 2)
  bedsOf(beds, 'ICU').forEach((b, i) => {
    const bx = iStart + i * (bayW + bayGap)
    out.push(place(b, 'ICU', bx + (bayW - BW) / 2, y0 + 12, BW, BH, 'top'))
  })
  for (let i = 0; i <= 4; i++) {
    const gx = iStart + i * (bayW + bayGap) - bayGap / 2
    glass.push([gx, y0, gx, y0 + 96])
  }
  const sCx = 120
  const station = `M ${sCx - 70} ${y0 + 106} Q ${sCx} ${y0 + 130} ${sCx + 70} ${y0 + 106} L ${sCx + 70} ${y0 + 116} Q ${sCx} ${y0 + 140} ${sCx - 70} ${y0 + 116} Z`
  plates.push(plate('ICU', 228, y0 + 120))
  walls.push([left, y0 + iH, right, y0 + iH])

  // Twin: four bays of two.
  y0 += iH
  const tH = 128
  zones.push({ ward: 'TWIN', x: left, y: y0, w: right - left, h: tH })
  const twinBayW = (right - left) / 4
  bedsOf(beds, 'TWIN').forEach((b, i) => {
    const bay = Math.floor(i / 2)
    const seat = i % 2
    const bx = left + bay * twinBayW
    const pad = (twinBayW - 2 * BW - 6) / 2
    out.push(place(b, 'TWIN', bx + pad + seat * (BW + 6), y0 + tH - 10 - BH, BW, BH, 'bottom'))
  })
  for (let i = 1; i < 4; i++) walls.push([left + i * twinBayW, y0 + 46, left + i * twinBayW, y0 + tH])
  plates.push(plate('TWIN', left + 10, y0 + 10))
  walls.push([left, y0 + tH, right, y0 + tH])

  // Private: six rooms.
  y0 += tH
  const pH = 128
  zones.push({ ward: 'PRIVATE', x: left, y: y0, w: right - left, h: pH })
  const roomW = (right - left) / 6
  bedsOf(beds, 'PRIVATE').forEach((b, i) => {
    const rx = left + i * roomW
    out.push(place(b, 'PRIVATE', rx + (roomW - BW) / 2, y0 + pH - 10 - BH, BW, BH, 'bottom'))
  })
  for (let i = 1; i < 6; i++) walls.push([left + i * roomW, y0 + 46, left + i * roomW, y0 + pH])
  plates.push(plate('PRIVATE', left + 10, y0 + 10))

  const bottom = y0 + pH
  const outerWalls: [number, number, number, number][] = [
    [left, 8, right, 8],
    [right, 8, right, bottom],
    [right, bottom, left, bottom],
    [left, bottom, left, 8],
  ]

  const bay = { x: left, y: bottom + 18, w: right - left, h: 82 }
  const slotW = 84
  const slotGap = (bay.w - 4 * slotW) / 5
  const ambulanceSlots: AmbulanceSlot[] = [0, 1, 2, 3].map((i) => ({
    index: i,
    x: bay.x + slotGap + i * (slotW + slotGap),
    y: bay.y + 18,
    w: slotW,
    h: 58,
  }))

  return {
    variant: 'tall',
    width: 400,
    height: bay.y + bay.h + 6,
    building: { x: left, y: 8, w: right - left, h: bottom - 8 },
    zones,
    corridors: [],
    walls,
    outerWalls,
    glass,
    curtains,
    doors,
    beds: out,
    plates,
    lines: [],
    fixtures: [{ kind: 'station', d: station }],
    labels: [
      { x: sCx, y: zones[1].y + 156, text: 'Nurses’ station', anchor: 'middle', tone: 'fixture' },
      { x: bay.x + slotGap, y: bay.y + 8, text: 'Ambulance bay', anchor: 'start', tone: 'note' },
    ],
    ambulanceBay: bay,
    ambulanceSlots,
  }
}

export function planLayout(beds: PlanBedInput[], variant: Variant): PlanLayout {
  const known = beds.filter((b) => isWard(b.ward))
  return variant === 'wide' ? wideLayout(known) : tallLayout(known)
}

/** The bed box a plan places for each bed id. */
export function bedBoxes(layout: PlanLayout): Map<number, BedBox> {
  return new Map(layout.beds.map((b) => [b.id, b]))
}

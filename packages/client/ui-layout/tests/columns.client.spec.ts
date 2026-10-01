import { describe, expect, it } from 'vitest'
import { clampWidth, computeColumns, RAIL_WIDTH } from '../src/client/columns.ts'

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

/* The rail is a fixed frame column, so every solve pays for it before either
   panel bids: each case carries it, and the eligibility boundaries sit 48px
   further right than the same solve without one. */
describe('computeColumns', () => {
  it('gives each edge column its preference when the center has enough room', () => {
    expect(computeColumns(1920, 280, 864)).toEqual({ sidebar: 280, center: 728, rightbar: 864, rail: RAIL_WIDTH })
  })

  it('keeps the left rail and the right rail when both panels are closed', () => {
    expect(computeColumns(1920, 0, 0)).toEqual({ sidebar: 56, center: 1816, rightbar: 0, rail: RAIL_WIDTH })
  })

  it('clamps sidebar preferences and limits the right panel to 70% of the frame', () => {
    expect(computeColumns(3000, 9999, 9999)).toEqual({ sidebar: 420, center: 432, rightbar: 2100, rail: RAIL_WIDTH })
    expect(computeColumns(1920, 1, 1)).toEqual({ sidebar: 264, center: 1308, rightbar: 300, rail: RAIL_WIDTH })
  })

  it.each([
    [1300, 280, 572, 400],
    [1100, 280, 372, 400],
    [1120, 420, 0, 652],
    [1119, 420, 0, 651],
    [1024, 420, 0, 556],
    [804, 0, 300, 400],
    [803, 0, 0, 699],
    [455, 0, 0, 351],
    [20, 0, 0, 0],
  ])('solves frame %i and sidebar %i to right %i and center %i', (viewport, sidebar, rightbar, center) => {
    expect(computeColumns(viewport, sidebar, 864)).toEqual({ sidebar: sidebar || 56, center, rightbar, rail: RAIL_WIDTH })
  })

  it('does not reduce the wide sidebar to keep a normal right panel open', () => {
    expect(computeColumns(1024, 420, 500)).toEqual({ sidebar: 420, center: 556, rightbar: 0, rail: RAIL_WIDTH })
  })

  it('restores a still-open preference when the frame widens', () => {
    expect(computeColumns(1100, 280, 864).rightbar).toBe(372)
    expect(computeColumns(1920, 280, 864).rightbar).toBe(864)
  })

  it('leaves a closed right track closed when the frame widens', () => {
    expect(computeColumns(755, 0, 0).rightbar).toBe(0)
    expect(computeColumns(1920, 0, 0).rightbar).toBe(0)
  })
})

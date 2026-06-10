// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { HISTORY_BYTE_BUDGET, useMaskHistory } from './useMaskHistory'

const SNAPSHOT_BYTES = 1920 * 1920 * 4 // 全分辨率 RGBA 快照 ≈ 14.1MiB

describe('useMaskHistory 接线(M24):pushSnapshot 必须走字节预算', () => {
  it('大快照连续入栈受 HISTORY_BYTE_BUDGET 约束(调用点回退为 pushBounded 时本测试会红)', () => {
    const fakeCtx = {
      getImageData: vi.fn(() => ({ data: { byteLength: SNAPSHOT_BYTES } }) as unknown as ImageData),
      putImageData: vi.fn(),
    }
    const canvas = {
      width: 1920,
      height: 1920,
      getContext: vi.fn(() => fakeCtx),
    } as unknown as HTMLCanvasElement
    const { result } = renderHook(() =>
      useMaskHistory({
        maskCanvasRef: { current: canvas },
        renderPreview: () => {},
        fillWhiteMask: () => {},
      }),
    )

    act(() => {
      for (let i = 0; i < 40; i++) result.current.pushSnapshot()
    })

    const expected = Math.floor(HISTORY_BYTE_BUDGET / SNAPSHOT_BYTES)
    expect(expected).toBeLessThan(40) // 前提自检:该尺寸下预算确实比条数上限更紧
    expect(result.current.undoStackRef.current.length).toBe(expected)
  })
})

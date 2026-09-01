// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useHintTooltip } from './useHintTooltip'

function Harness({ enabled = true }: { enabled?: boolean }) {
  const hint = useHintTooltip<HTMLButtonElement>({ enabled })
  return (
    <div>
      <button type="button" {...hint.anchorProps} data-testid="anchor">
        anchor
      </button>
      {hint.visible && <div data-testid="tip">tip</div>}
      <button type="button" data-testid="outside">
        outside
      </button>
    </div>
  )
}

const touch = (x: number, y: number) => ({ clientX: x, clientY: y })

describe('useHintTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('悬停显示、移出隐藏', () => {
    render(<Harness />)
    const anchor = screen.getByTestId('anchor')
    fireEvent.mouseEnter(anchor)
    expect(screen.queryByTestId('tip')).not.toBeNull()
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByTestId('tip')).toBeNull()
  })

  it('聚焦显示、失焦隐藏', () => {
    render(<Harness />)
    const anchor = screen.getByTestId('anchor')
    fireEvent.focus(anchor)
    expect(screen.queryByTestId('tip')).not.toBeNull()
    fireEvent.blur(anchor)
    expect(screen.queryByTestId('tip')).toBeNull()
  })

  it('enabled=false 时所有显示入口静默', () => {
    render(<Harness enabled={false} />)
    const anchor = screen.getByTestId('anchor')
    fireEvent.mouseEnter(anchor)
    fireEvent.focus(anchor)
    fireEvent.touchStart(anchor, { touches: [touch(10, 10)] })
    fireEvent.touchEnd(anchor, { changedTouches: [touch(10, 10)] })
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.queryByTestId('tip')).toBeNull()
  })

  it('已显示时 enabled 变 false 立即收起', () => {
    const { rerender } = render(<Harness />)
    fireEvent.mouseEnter(screen.getByTestId('anchor'))
    expect(screen.queryByTestId('tip')).not.toBeNull()
    rerender(<Harness enabled={false} />)
    expect(screen.queryByTestId('tip')).toBeNull()
  })

  it('触屏轻点显示,仿真 mouseenter 不打断 2.5s 自动隐藏', () => {
    render(<Harness />)
    const anchor = screen.getByTestId('anchor')
    fireEvent.touchStart(anchor, { touches: [touch(10, 10)] })
    fireEvent.touchEnd(anchor, { changedTouches: [touch(12, 11)] })
    expect(screen.queryByTestId('tip')).not.toBeNull()
    // 浏览器在轻点后补发的仿真 mouseenter 不应清掉自动隐藏定时器
    fireEvent.mouseEnter(anchor)
    act(() => vi.advanceTimersByTime(2500))
    expect(screen.queryByTestId('tip')).toBeNull()
  })

  it('长按 450ms 显示,抬起后从抬起时刻重计自动隐藏', () => {
    render(<Harness />)
    const anchor = screen.getByTestId('anchor')
    fireEvent.touchStart(anchor, { touches: [touch(10, 10)] })
    act(() => vi.advanceTimersByTime(450))
    expect(screen.queryByTestId('tip')).not.toBeNull()
    fireEvent.touchEnd(anchor, { changedTouches: [touch(10, 10)] })
    act(() => vi.advanceTimersByTime(2499))
    expect(screen.queryByTestId('tip')).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByTestId('tip')).toBeNull()
  })

  it('滚动手势(位移超阈值)不显示,抬起也不补显示', () => {
    render(<Harness />)
    const anchor = screen.getByTestId('anchor')
    fireEvent.touchStart(anchor, { touches: [touch(10, 10)] })
    fireEvent.touchMove(anchor, { touches: [touch(10, 60)] })
    act(() => vi.advanceTimersByTime(450))
    expect(screen.queryByTestId('tip')).toBeNull()
    fireEvent.touchEnd(anchor, { changedTouches: [touch(10, 60)] })
    expect(screen.queryByTestId('tip')).toBeNull()
  })

  it('可见时外点(pointerdown)关闭,点锚点自身不关闭', () => {
    render(<Harness />)
    const anchor = screen.getByTestId('anchor')
    fireEvent.mouseEnter(anchor)
    fireEvent.pointerDown(anchor)
    expect(screen.queryByTestId('tip')).not.toBeNull()
    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(screen.queryByTestId('tip')).toBeNull()
  })

  it('可见时 Esc 关闭', () => {
    render(<Harness />)
    fireEvent.mouseEnter(screen.getByTestId('anchor'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('tip')).toBeNull()
  })
})

// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import MaskInfoPopover from './MaskInfoPopover'

function Harness() {
  const [open, setOpen] = useState(false)
  return <MaskInfoPopover open={open} onOpenChange={setOpen} />
}

const INFO_TEXT = /仅基于提示词/
const anchor = () => screen.getByRole('button', { name: '遮罩编辑说明' })

describe('MaskInfoPopover', () => {
  afterEach(() => {
    cleanup()
  })

  it('点击切换打开/关闭,并同步 aria-expanded', () => {
    render(<Harness />)
    expect(anchor().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(anchor())
    expect(screen.queryByText(INFO_TEXT)).not.toBeNull()
    expect(anchor().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(anchor())
    expect(screen.queryByText(INFO_TEXT)).toBeNull()
  })

  it('打开后点外部关闭', () => {
    render(<Harness />)
    fireEvent.click(anchor())
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText(INFO_TEXT)).toBeNull()
  })

  it('打开后 Esc 关闭', () => {
    render(<Harness />)
    fireEvent.click(anchor())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText(INFO_TEXT)).toBeNull()
  })

  it('触屏轻点(含补发的仿真 mouseenter)能打开,再点一次能关闭', () => {
    render(<Harness />)
    // 模拟浏览器轻点事件序:touchstart → touchend → 仿真 mouseenter → click
    fireEvent.touchStart(anchor())
    fireEvent.touchEnd(anchor())
    fireEvent.mouseEnter(anchor())
    fireEvent.click(anchor())
    expect(screen.queryByText(INFO_TEXT)).not.toBeNull()
    // 第二次轻点:pointerdown 落在锚点上不触发外点关闭,由 click 负责 toggle
    fireEvent.pointerDown(anchor())
    fireEvent.touchStart(anchor())
    fireEvent.touchEnd(anchor())
    fireEvent.mouseEnter(anchor())
    fireEvent.click(anchor())
    expect(screen.queryByText(INFO_TEXT)).toBeNull()
  })

  it('桌面悬停即时预览,移出即收起', () => {
    render(<Harness />)
    fireEvent.mouseEnter(anchor())
    expect(screen.queryByText(INFO_TEXT)).not.toBeNull()
    fireEvent.mouseLeave(anchor())
    expect(screen.queryByText(INFO_TEXT)).toBeNull()
  })
})

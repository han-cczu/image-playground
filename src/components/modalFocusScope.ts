import { createContext, useContext, useEffect, type RefObject } from 'react'

/**
 * Modal 的焦点作用域:portal 到 body 的附属面板(如收藏分类菜单)不在 Modal 面板 DOM 之内,
 * useFocusTrap 会把 Tab 拉回弹窗首控件,键盘用户进不了菜单、菜单里的输入框按 Tab 被拽走。
 * 附属面板打开时把自己的容器注册进来,Modal 把它们并入 useFocusTrap 的 extraContainerRefs。
 * 不放在 Modal.tsx:该文件只导出组件(react-refresh/only-export-components)。
 */
export interface ModalFocusScope {
  /** 注册一个环内容器,返回注销函数 */
  register: (ref: RefObject<HTMLElement | null>) => () => void
}

export const ModalFocusScopeContext = createContext<ModalFocusScope | null>(null)

/** 在 Modal 内渲染、且 portal 到面板之外的组件:active 期间把 ref 注册进所在 Modal 的焦点环。 */
export function useModalFocusScopeMember(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
): void {
  const scope = useContext(ModalFocusScopeContext)
  useEffect(() => {
    if (!active || !scope) return
    return scope.register(ref)
  }, [active, scope, ref])
}

import { afterEach, describe, expect, it } from 'vitest'
import {
  getInFlightImageIds,
  registerInFlightImages,
  releaseInFlightImages,
  resetInFlightImagesForTest,
} from './inFlightImages'

describe('inFlightImages 在途图片登记表', () => {
  afterEach(() => resetInFlightImagesForTest())

  it('按 owner 登记与注销,查询可排除自己', () => {
    registerInFlightImages('task-a', ['img-1', 'img-2'])
    registerInFlightImages('task-b', ['img-2', 'img-3'])

    expect(getInFlightImageIds()).toEqual(new Set(['img-1', 'img-2', 'img-3']))
    // 回滚自己的图时:img-2 仍被 task-b 持有,不能删;img-1 只属于自己,可删
    expect(getInFlightImageIds('task-a')).toEqual(new Set(['img-2', 'img-3']))

    releaseInFlightImages('task-b')
    expect(getInFlightImageIds()).toEqual(new Set(['img-1', 'img-2']))
    releaseInFlightImages('task-a')
    expect(getInFlightImageIds()).toEqual(new Set())
  })

  it('空登记不创建条目,重复注销无副作用', () => {
    registerInFlightImages('none', [])
    releaseInFlightImages('none')
    releaseInFlightImages('none')
    expect(getInFlightImageIds()).toEqual(new Set())
  })
})

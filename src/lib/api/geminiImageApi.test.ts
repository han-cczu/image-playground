import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { DEFAULT_GEMINI_BASE_URL, DEFAULT_GEMINI_MODEL, DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi } from '.'

describe('callGeminiImageApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports partial failures for concurrent Gemini requests', async () => {
    let callIndex = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callIndex += 1
      if (callIndex === 3) {
        return new Response(JSON.stringify({
          error: { message: 'gemini request failed' },
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              inline_data: {
                mime_type: 'image/png',
                data: `aW1hZ2Ut${callIndex}`,
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const result = await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        activeProfileId: 'gemini',
        profiles: [{
          id: 'gemini',
          name: 'Gemini',
          provider: 'gemini',
          baseUrl: DEFAULT_GEMINI_BASE_URL,
          apiKey: 'gemini-key',
          model: DEFAULT_GEMINI_MODEL,
          timeout: 600,
        }],
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, n: 3 },
      inputImageDataUrls: [],
    })

    expect(result.images).toHaveLength(2)
    expect(result.partialFailureCount).toBe(1)
    expect(result.partialFailureMessage).toContain('gemini request failed')
    expect(result.actualParams).toMatchObject({ n: 2 })
  })
})

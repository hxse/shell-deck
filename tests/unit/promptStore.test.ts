import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PromptStore } from '../../src/lib/prompts/promptStore'

test('prompt store supports project and global CRUD with search', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-prompts-'))
  try {
    const store = new PromptStore(root)
    const project = store.create('project', 'local', { promptId: 'review_task', title: 'Review Task', body: '审查当前任务，只输出 P1/P2/P3。', tags: ['review', 'task'] })
    const global = store.create('global', 'local', { promptId: 'fix_prompt', title: 'Fix Prompt', body: '修复这些问题', tags: 'fix, worker' })

    expect(project.scope).toBe('project')
    expect(project.configId).toBe('local')
    expect(global.scope).toBe('global')
    expect(global.configId).toBeUndefined()
    expect(store.list('local', { scope: 'project' }).map((prompt) => prompt.promptId)).toEqual(['review_task'])
    expect(store.list('local', { scope: 'global' }).map((prompt) => prompt.promptId)).toEqual(['fix_prompt'])
    expect(store.list('local', { scope: 'all' }).map((prompt) => prompt.promptId).sort()).toEqual(['fix_prompt', 'review_task'])
    expect(store.list('local', { q: 'P2' }).map((prompt) => prompt.promptId)).toEqual(['review_task'])
    expect(store.list('local', { q: 'worker' }).map((prompt) => prompt.promptId)).toEqual(['fix_prompt'])

    const updated = store.update('project', 'local', 'review_task', { title: 'Review Updated', body: 'updated body', tags: ['updated'] })
    expect(updated.title).toBe('Review Updated')
    expect(store.read('project', 'local', 'review_task').body).toBe('updated body')

    store.delete('project', 'local', 'review_task')
    expect(store.list('local', { scope: 'project' })).toEqual([])
    expect(store.list('local', { scope: 'global' }).map((prompt) => prompt.promptId)).toEqual(['fix_prompt'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('prompt store isolates project configs and rejects path traversal ids', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-prompts-'))
  try {
    const store = new PromptStore(root)
    store.create('project', 'alpha', { promptId: 'same_id', title: 'Alpha', body: 'alpha' })
    store.create('project', 'beta', { promptId: 'same_id', title: 'Beta', body: 'beta' })
    expect(store.read('project', 'alpha', 'same_id').title).toBe('Alpha')
    expect(store.read('project', 'beta', 'same_id').title).toBe('Beta')
    expect(() => store.create('project', 'alpha', { promptId: '../bad', title: 'Bad', body: '' })).toThrow()
    expect(() => store.read('project', '../bad', 'same_id')).toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})


test('prompt store moves saved prompts between project and global scopes', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-prompts-'))
  try {
    const store = new PromptStore(root)
    store.create('project', 'local', { promptId: 'move_me', title: 'Move Me', body: 'project body', tags: ['project'] })

    const moved = store.update('project', 'local', 'move_me', { scope: 'global', title: 'Moved', body: 'global body', tags: ['global'] })
    expect(moved.scope).toBe('global')
    expect(moved.configId).toBeUndefined()
    expect(moved.title).toBe('Moved')
    expect(store.list('local', { scope: 'project' })).toEqual([])
    expect(store.read('global', 'local', 'move_me').body).toBe('global body')
    expect(() => store.read('project', 'local', 'move_me')).toThrow('prompt_not_found:move_me')

    const movedBack = store.update('global', 'local', 'move_me', { scope: 'project', title: 'Moved Back' })
    expect(movedBack.scope).toBe('project')
    expect(movedBack.configId).toBe('local')
    expect(store.read('project', 'local', 'move_me').title).toBe('Moved Back')
    expect(() => store.read('global', 'local', 'move_me')).toThrow('prompt_not_found:move_me')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('prompt store rejects scope moves that collide with an existing prompt id', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-prompts-'))
  try {
    const store = new PromptStore(root)
    store.create('project', 'local', { promptId: 'same_id', title: 'Project', body: 'project' })
    store.create('global', 'local', { promptId: 'same_id', title: 'Global', body: 'global' })

    expect(() => store.update('project', 'local', 'same_id', { scope: 'global' })).toThrow('prompt_id_conflict:same_id')
    expect(store.read('project', 'local', 'same_id').title).toBe('Project')
    expect(store.read('global', 'local', 'same_id').title).toBe('Global')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

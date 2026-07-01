export type PromptScope = 'project' | 'global'
export type PromptScopeFilter = PromptScope | 'all'

export type PromptRecord = {
  schemaVersion: 1
  promptId: string
  scope: PromptScope
  configId?: string
  title: string
  body: string
  tags?: string[]
  description?: string
  createdAt: string
  updatedAt: string
}

export type PromptSummary = Pick<PromptRecord, 'promptId' | 'scope' | 'configId' | 'title' | 'tags' | 'updatedAt'> & {
  bodyPreview: string
}

export type PromptListResult = {
  prompts: PromptSummary[]
}

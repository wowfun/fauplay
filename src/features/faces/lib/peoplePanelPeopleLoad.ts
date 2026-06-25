import type { PersonScope, PersonSummary } from '../types.ts'
import type { NoticeTone } from './peoplePanelText.ts'
import { resolvePeoplePanelRefreshedPeopleSelection } from './peoplePanelModel.ts'

export interface PeoplePanelPeopleApiContext {
  rootHandle: FileSystemDirectoryHandle | null
  rootId: string
}

export interface LoadPeoplePanelPeopleListParams {
  context: PeoplePanelPeopleApiContext
  scope: PersonScope
  query: string
  listPeople: (
    context: PeoplePanelPeopleApiContext,
    options: { scope: PersonScope; query?: string; size: number },
  ) => Promise<PersonSummary[]>
}

export interface LoadPeoplePanelAllPeopleParams {
  context: PeoplePanelPeopleApiContext
  scope: PersonScope
  listPeople: (
    context: PeoplePanelPeopleApiContext,
    options: { scope: PersonScope; size: number },
  ) => Promise<PersonSummary[]>
}

export type PeoplePanelPeopleLoadResult =
  | { kind: 'loaded'; people: PersonSummary[] }
  | { kind: 'failed'; message: string }

export interface PeoplePanelPeopleListLoadCommit {
  people: PersonSummary[]
  nextSelectedPersonId: string | null | undefined
  notice: { tone: NoticeTone; message: string } | null
}

export interface PeoplePanelAllPeopleLoadCommit {
  allPeople: PersonSummary[] | undefined
  notice: { tone: NoticeTone; message: string } | null
}

export async function loadPeoplePanelPeopleList({
  context,
  scope,
  query,
  listPeople,
}: LoadPeoplePanelPeopleListParams): Promise<PeoplePanelPeopleLoadResult> {
  const trimmedQuery = query.trim()
  try {
    return {
      kind: 'loaded',
      people: await listPeople(context, {
        scope,
        query: trimmedQuery || undefined,
        size: 300,
      }),
    }
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : '人物列表读取失败',
    }
  }
}

export async function loadPeoplePanelAllPeople({
  context,
  scope,
  listPeople,
}: LoadPeoplePanelAllPeopleParams): Promise<PeoplePanelPeopleLoadResult> {
  try {
    return {
      kind: 'loaded',
      people: await listPeople(context, {
        scope,
        size: 400,
      }),
    }
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : '人物列表读取失败',
    }
  }
}

export function resolvePeoplePanelPeopleListLoadCommit(
  result: PeoplePanelPeopleLoadResult,
  options: { previousSelectedPersonId: string | null },
): PeoplePanelPeopleListLoadCommit {
  if (result.kind === 'failed') {
    return {
      people: [],
      nextSelectedPersonId: undefined,
      notice: {
        tone: 'error',
        message: result.message,
      },
    }
  }

  return {
    people: result.people,
    nextSelectedPersonId: resolvePeoplePanelRefreshedPeopleSelection({
      previousSelectedPersonId: options.previousSelectedPersonId,
      people: result.people,
    }),
    notice: null,
  }
}

export function resolvePeoplePanelAllPeopleLoadCommit(
  result: PeoplePanelPeopleLoadResult,
): PeoplePanelAllPeopleLoadCommit {
  if (result.kind === 'failed') {
    return {
      allPeople: undefined,
      notice: {
        tone: 'error',
        message: result.message,
      },
    }
  }
  return {
    allPeople: result.people,
    notice: null,
  }
}

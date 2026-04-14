interface PersonIdentityLike {
  personId: string | null | undefined
  name: string | null | undefined
}

function trimName(name: string | null | undefined): string {
  return typeof name === 'string' ? name.trim() : ''
}

export function formatUnnamedPersonDisplayName(personId: string | null | undefined): string {
  return `未命名 ${String(personId || '').slice(0, 8)}`
}

export function formatLegacyUnnamedPersonDisplayName(personId: string | null | undefined): string {
  return `人物 ${String(personId || '').slice(0, 8)}`
}

export function formatLegacyBracketUnnamedPersonDisplayName(personId: string | null | undefined): string {
  return `(${formatUnnamedPersonDisplayName(personId)})`
}

export function getPersonDisplayName(person: PersonIdentityLike): string {
  const trimmedName = trimName(person.name)
  return trimmedName || formatUnnamedPersonDisplayName(person.personId)
}

export function getLegacyAwarePersonDisplayName(person: PersonIdentityLike): string {
  const trimmedName = trimName(person.name)
  if (!trimmedName) {
    return formatUnnamedPersonDisplayName(person.personId)
  }

  if (
    trimmedName === formatLegacyUnnamedPersonDisplayName(person.personId)
    || trimmedName === formatLegacyBracketUnnamedPersonDisplayName(person.personId)
  ) {
    return formatUnnamedPersonDisplayName(person.personId)
  }

  return trimmedName
}

export function getPersonSearchAliases(person: PersonIdentityLike): string[] {
  const aliases = [getPersonDisplayName(person)]
  if (trimName(person.name)) {
    return aliases
  }

  aliases.push(
    formatLegacyUnnamedPersonDisplayName(person.personId),
    formatLegacyBracketUnnamedPersonDisplayName(person.personId),
  )
  return aliases
}

export function matchesNormalizedPersonAlias(person: PersonIdentityLike, normalizedQuery: string): boolean {
  if (!normalizedQuery) return false
  return getPersonSearchAliases(person).some((alias) => alias.toLowerCase() === normalizedQuery)
}

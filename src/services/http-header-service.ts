export type HeaderValueIssue = {
  index: number;
  charCode: number;
};

export function findInvalidHeaderValueCharacter(value: string): HeaderValueIssue | undefined {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);

    if (charCode > 255 || charCode === 0 || charCode === 10 || charCode === 13) {
      return {
        index,
        charCode
      };
    }
  }

  return undefined;
}

export function isAsciiVisibleSecret(value: string) {
  return /^[\x21-\x7E]+$/.test(value);
}

export function isSafeApiKeyForHeader(value?: string) {
  const trimmed = value?.trim() ?? "";

  return Boolean(trimmed) && isAsciiVisibleSecret(trimmed) && !findInvalidHeaderValueCharacter(trimmed);
}


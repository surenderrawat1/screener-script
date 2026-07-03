import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { translateVerify, type VerifyLang } from './verifyFull';

const STORAGE_KEY = 'sv:lang';

export function useVerifyLang() {
  const [searchParams, setSearchParams] = useSearchParams();
  const paramLang = searchParams.get('lang');
  const lang: VerifyLang =
    paramLang === 'hi' || paramLang === 'en'
      ? paramLang
      : (localStorage.getItem(STORAGE_KEY) as VerifyLang | null) === 'hi'
        ? 'hi'
        : 'en';

  const setLang = useCallback(
    (next: VerifyLang) => {
      localStorage.setItem(STORAGE_KEY, next);
      const nextParams = new URLSearchParams(searchParams);
      if (next === 'en') nextParams.delete('lang');
      else nextParams.set('lang', next);
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const t = useCallback(
    (key: string, fallback: string) => translateVerify(lang, key, fallback),
    [lang],
  );

  return useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
}

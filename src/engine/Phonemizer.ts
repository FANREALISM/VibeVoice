export const romajiToHiraganaMap: Record<string, string> = {
  "a": "あ", "i": "い", "u": "う", "e": "え", "o": "お",
  "ka": "か", "ki": "き", "ku": "く", "ke": "け", "ko": "こ",
  "ca": "ちゃ", "ci": "ち", "cu": "ちゅ", "ce": "ちぇ", "co": "ちょ", 
  "ga": "が", "gi": "ぎ", "gu": "ぐ", "ge": "げ", "go": "ご",
  "sa": "さ", "si": "し", "shi": "し", "su": "す", "se": "せ", "so": "そ",
  "za": "ざ", "ji": "じ", "zi": "じ", "zu": "ず", "ze": "ぜ", "zo": "ぞ",
  "ta": "た", "chi": "ち", "ti": "ち", "tsu": "つ", "tu": "つ", "te": "て", "to": "と",
  "da": "だ", "di": "ぢ", "du": "づ", "de": "で", "do": "ど",
  "na": "な", "ni": "に", "nu": "ぬ", "ne": "ね", "no": "の",
  "ha": "は", "hi": "ひ", "fu": "ふ", "hu": "ふ", "he": "へ", "ho": "ほ",
  "ba": "ば", "bi": "び", "bu": "ぶ", "be": "べ", "bo": "ぼ",
  "pa": "ぱ", "pi": "ぴ", "pu": "ぷ", "pe": "ぺ", "po": "ぽ",
  "ma": "ま", "mi": "み", "mu": "む", "me": "め", "mo": "も",
  "ya": "や", "yu": "ゆ", "yo": "よ",
  "ra": "ら", "ri": "り", "ru": "る", "re": "れ", "ro": "ろ",
  "wa": "わ", "wi": "うぃ", "we": "うぇ", "wo": "を", "nn": "ん", "n": "ん",
  "kya": "きゃ", "kyu": "きゅ", "kyo": "きょ",
  "sha": "しゃ", "sya": "しゃ", "shu": "しゅ", "syu": "しゅ", "sho": "しょ", "syo": "しょ",
  "cha": "ちゃ", "tya": "ちゃ", "chu": "ちゅ", "tyu": "ちゅ", "cho": "ちょ", "tyo": "ちょ",
  "nya": "にゃ", "nyu": "にゅ", "nyo": "にょ",
  "hya": "ひゃ", "hyu": "ひゅ", "hyo": "ひょ",
  "mya": "みゃ", "myu": "みゅ", "myo": "みょ",
  "rya": "りゃ", "ryu": "りゅ", "ryo": "りょ",
  "gya": "ぎゃ", "gyu": "ぎゅ", "gyo": "ぎょ",
  "ja": "じゃ", "zya": "じゃ", "ju": "じゅ", "zyu": "じゅ", "jo": "じょ", "zyo": "じょ",
  "bya": "びゃ", "byu": "びゅ", "byo": "びょ",
  "pya": "ぴゃ", "pyu": "ぴゅ", "pyo": "ぴょ"
};

// Small manual overrides — take priority over the CMU dictionary for brand/
// stylized pronunciations that don't match standard dictionary entries.
const engDict: Record<string, string[]> = {
  "vibe": ["v", "ay", "b"],
  "voice": ["v", "oy", "s"],
  "kocak": ["k", "ow", "ch", "ah", "k"]
};

// CMU Pronouncing Dictionary: 134,000+ English words with ARPABET transcriptions.
// This is the real fix for English lyrics — previously only 8 words were hardcoded
// and everything else fell through to a naive per-letter guesser.
// Loaded lazily (dynamic import) so the ~4.6MB dictionary doesn't bloat the main
// app bundle — call preloadCmuDictionary() once (done in AudioEngine.init()) and
// it'll be ready by the time playback actually needs it.
let cmuDict: Record<string, string> | null = null;
let cmuDictLoading: Promise<void> | null = null;

export function preloadCmuDictionary(): Promise<void> {
  if (cmuDict) return Promise.resolve();
  if (!cmuDictLoading) {
    cmuDictLoading = import('cmu-pronouncing-dictionary').then(mod => {
      cmuDict = mod.dictionary;
    }).catch(err => {
      console.warn('Failed to load CMU pronouncing dictionary, falling back to naive phonemizer:', err);
      cmuDictLoading = null; // allow retry on next call
    });
  }
  return cmuDictLoading;
}

function cmuLookup(word: string): string[] | undefined {
  if (!cmuDict) return undefined; // not loaded yet — caller falls back
  const entry = cmuDict[word];
  if (!entry) return undefined;
  // CMU phonemes look like "HH AH0 L OW1" — strip stress digits (0/1/2) and
  // lowercase so they match the arpabetToXSampa keys used downstream.
  return entry.split(' ').map(p => p.replace(/[0-9]/g, '').toLowerCase());
}

function naiveFallback(clean: string): string[] {
  // Last-resort letter-by-letter guesser for words not in the dictionary
  // (made-up words, slang, typos). Crude on purpose — real coverage comes
  // from the CMU dictionary above.
  const out: string[] = [];
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if ("aeiouy".includes(char)) {
      if (char === 'a') out.push('aa');
      else if (char === 'e') out.push('eh');
      else if (char === 'i') out.push('ih');
      else if (char === 'o') out.push('ao');
      else if (char === 'u') out.push('uh');
      else if (char === 'y') out.push('iy');
    } else {
      if (char === 'c') out.push('k');
      else if (char === 'q') out.push('k');
      else if (char === 'x') {
        out.push('k');
        out.push('s');
      } else {
        out.push(char);
      }
    }
  }
  return out;
}

// Handles a single note's lyric, which may be one word or a short phrase
// (space-separated). Looks up each token in the CMU dictionary first,
// falling back to the manual overrides, then the naive guesser.
export function parseEnglishToPhonemes(word: string): string[] {
  const tokens = word.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const out: string[] = [];
  for (const rawToken of tokens) {
    // Strip surrounding punctuation but keep internal apostrophes (don't, can't)
    const clean = rawToken.replace(/^[^a-z']+|[^a-z']+$/g, '');
    if (!clean) continue;

    if (engDict[clean]) {
      out.push(...engDict[clean]);
      continue;
    }
    const fromDict = cmuLookup(clean);
    if (fromDict) {
      out.push(...fromDict);
      continue;
    }
    out.push(...naiveFallback(clean));
  }
  return out;
}

export function buildCVVCAliases(phonemes: string[]): string[] {
  const queries = [];
  if (phonemes.length === 0) return [];
  
  queries.push(`- ${phonemes[0]}`);
  for (let i = 0; i < phonemes.length - 1; i++) {
    queries.push(`${phonemes[i]} ${phonemes[i+1]}`);
  }
  queries.push(`${phonemes[phonemes.length - 1]} -`);
  
  return queries;
}

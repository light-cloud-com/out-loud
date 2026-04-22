// Shared constants

const SERVER_URL = "http://localhost:51730";
const DEFAULT_LANGUAGE = "en-us";
const DEFAULT_VOICE = "af_heart";
const DEFAULT_VOLUME = 80;
const DEFAULT_HIGHLIGHT_CHUNK = true;

const DEFAULT_SETTINGS = {
  text: "",
  voice: DEFAULT_VOICE,
  language: DEFAULT_LANGUAGE,
  volume: DEFAULT_VOLUME,
  highlightChunk: DEFAULT_HIGHLIGHT_CHUNK,
};

const VOICES = {
  "en-us": [
    { id: "af_heart", name: "Heart", gender: "Female" },
    { id: "af_bella", name: "Bella", gender: "Female" },
    { id: "af_nicole", name: "Nicole", gender: "Female" },
    { id: "af_aoede", name: "Aoede", gender: "Female" },
    { id: "af_kore", name: "Kore", gender: "Female" },
    { id: "af_sarah", name: "Sarah", gender: "Female" },
    { id: "af_nova", name: "Nova", gender: "Female" },
    { id: "af_sky", name: "Sky", gender: "Female" },
    { id: "af_alloy", name: "Alloy", gender: "Female" },
    { id: "af_jessica", name: "Jessica", gender: "Female" },
    { id: "af_river", name: "River", gender: "Female" },
    { id: "am_michael", name: "Michael", gender: "Male" },
    { id: "am_fenrir", name: "Fenrir", gender: "Male" },
    { id: "am_puck", name: "Puck", gender: "Male" },
    { id: "am_echo", name: "Echo", gender: "Male" },
    { id: "am_eric", name: "Eric", gender: "Male" },
    { id: "am_liam", name: "Liam", gender: "Male" },
    { id: "am_onyx", name: "Onyx", gender: "Male" },
    { id: "am_santa", name: "Santa", gender: "Male" },
    { id: "am_adam", name: "Adam", gender: "Male" },
  ],
  "en-gb": [
    { id: "bf_emma", name: "Emma", gender: "Female" },
    { id: "bf_isabella", name: "Isabella", gender: "Female" },
    { id: "bf_alice", name: "Alice", gender: "Female" },
    { id: "bf_lily", name: "Lily", gender: "Female" },
    { id: "bm_george", name: "George", gender: "Male" },
    { id: "bm_lewis", name: "Lewis", gender: "Male" },
    { id: "bm_daniel", name: "Daniel", gender: "Male" },
    { id: "bm_fable", name: "Fable", gender: "Male" },
  ],
  ja: [
    { id: "jf_alpha", name: "Alpha", gender: "Female" },
    { id: "jf_gongitsune", name: "Gongitsune", gender: "Female" },
    { id: "jf_nezumi", name: "Nezumi", gender: "Female" },
    { id: "jf_tebukuro", name: "Tebukuro", gender: "Female" },
    { id: "jm_kumo", name: "Kumo", gender: "Male" },
  ],
  cmn: [
    { id: "zf_xiaobei", name: "Xiaobei", gender: "Female" },
    { id: "zf_xiaoni", name: "Xiaoni", gender: "Female" },
    { id: "zf_xiaoxiao", name: "Xiaoxiao", gender: "Female" },
    { id: "zf_xiaoyi", name: "Xiaoyi", gender: "Female" },
    { id: "zm_yunjian", name: "Yunjian", gender: "Male" },
    { id: "zm_yunxi", name: "Yunxi", gender: "Male" },
    { id: "zm_yunxia", name: "Yunxia", gender: "Male" },
    { id: "zm_yunyang", name: "Yunyang", gender: "Male" },
  ],
  "es-419": [
    { id: "ef_dora", name: "Dora", gender: "Female" },
    { id: "em_alex", name: "Alex", gender: "Male" },
    { id: "em_santa", name: "Santa", gender: "Male" },
  ],
  hi: [
    { id: "hf_alpha", name: "Alpha", gender: "Female" },
    { id: "hf_beta", name: "Beta", gender: "Female" },
    { id: "hm_omega", name: "Omega", gender: "Male" },
    { id: "hm_psi", name: "Psi", gender: "Male" },
  ],
  it: [
    { id: "if_sara", name: "Sara", gender: "Female" },
    { id: "im_nicola", name: "Nicola", gender: "Male" },
  ],
  "pt-br": [
    { id: "pf_dora", name: "Dora", gender: "Female" },
    { id: "pm_alex", name: "Alex", gender: "Male" },
    { id: "pm_santa", name: "Santa", gender: "Male" },
  ],
};

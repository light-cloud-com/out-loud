import { useEffect } from "react";

const VOICES: Record<string, { id: string; name: string }[]> = {
  "en-us": [
    { id: "af_heart", name: "Heart" },
    { id: "af_bella", name: "Bella" },
    { id: "af_nicole", name: "Nicole" },
    { id: "af_aoede", name: "Aoede" },
    { id: "af_kore", name: "Kore" },
    { id: "af_sarah", name: "Sarah" },
    { id: "af_nova", name: "Nova" },
    { id: "af_sky", name: "Sky" },
    { id: "af_alloy", name: "Alloy" },
    { id: "af_jessica", name: "Jessica" },
    { id: "af_river", name: "River" },
    { id: "am_michael", name: "Michael" },
    { id: "am_fenrir", name: "Fenrir" },
    { id: "am_puck", name: "Puck" },
    { id: "am_echo", name: "Echo" },
    { id: "am_eric", name: "Eric" },
    { id: "am_liam", name: "Liam" },
    { id: "am_onyx", name: "Onyx" },
    { id: "am_santa", name: "Santa" },
    { id: "am_adam", name: "Adam" },
  ],
  "en-gb": [
    { id: "bf_emma", name: "Emma" },
    { id: "bf_isabella", name: "Isabella" },
    { id: "bf_alice", name: "Alice" },
    { id: "bf_lily", name: "Lily" },
    { id: "bm_george", name: "George" },
    { id: "bm_lewis", name: "Lewis" },
    { id: "bm_daniel", name: "Daniel" },
    { id: "bm_fable", name: "Fable" },
  ],
  "es-419": [
    { id: "ef_dora", name: "Dora" },
    { id: "em_alex", name: "Alex" },
    { id: "em_santa", name: "Santa" },
  ],
  "pt-br": [
    { id: "pf_dora", name: "Dora" },
    { id: "pm_alex", name: "Alex" },
    { id: "pm_santa", name: "Santa" },
  ],
  it: [
    { id: "if_sara", name: "Sara" },
    { id: "im_nicola", name: "Nicola" },
  ],
  hi: [
    { id: "hf_alpha", name: "Alpha" },
    { id: "hf_beta", name: "Beta" },
    { id: "hm_omega", name: "Omega" },
    { id: "hm_psi", name: "Psi" },
  ],
  ja: [
    { id: "jf_alpha", name: "Alpha" },
    { id: "jf_gongitsune", name: "Gongitsune" },
    { id: "jf_nezumi", name: "Nezumi" },
    { id: "jf_tebukuro", name: "Tebukuro" },
    { id: "jm_kumo", name: "Kumo" },
  ],
  cmn: [
    { id: "zf_xiaobei", name: "Xiaobei" },
    { id: "zf_xiaoni", name: "Xiaoni" },
    { id: "zf_xiaoxiao", name: "Xiaoxiao" },
    { id: "zf_xiaoyi", name: "Xiaoyi" },
    { id: "zm_yunjian", name: "Yunjian" },
    { id: "zm_yunxi", name: "Yunxi" },
    { id: "zm_yunxia", name: "Yunxia" },
    { id: "zm_yunyang", name: "Yunyang" },
  ],
};

const LANGUAGES = [
  { value: "en-us", label: "English (US)" },
  { value: "en-gb", label: "English (UK)" },
  { value: "es-419", label: "Spanish" },
  { value: "pt-br", label: "Portuguese (BR)" },
  { value: "it", label: "Italian" },
  { value: "hi", label: "Hindi" },
  { value: "ja", label: "Japanese" },
  { value: "cmn", label: "Chinese" },
];

interface VoiceSelectProps {
  language: string;
  voice: string;
  onLanguageChange: (lang: string) => void;
  onVoiceChange: (voice: string) => void;
  disabled?: boolean;
}

export function VoiceSelect({
  language,
  voice,
  onLanguageChange,
  onVoiceChange,
  disabled,
}: VoiceSelectProps) {
  const voices = VOICES[language] || VOICES["en-us"];

  // Update voice when language changes
  useEffect(() => {
    const availableVoices = VOICES[language] || VOICES["en-us"];
    if (!availableVoices.find((v) => v.id === voice)) {
      onVoiceChange(availableVoices[0].id);
    }
  }, [language, voice, onVoiceChange]);

  const selectClass = `
    w-full px-3.5 py-2.5 pr-10
    border border-gray-700/50 rounded-md
    bg-gray-800/50 text-gray-100 text-sm
    appearance-none cursor-pointer
    bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')]
    bg-[length:1.25rem_1.25rem] bg-[right_0.75rem_center] bg-no-repeat
    disabled:opacity-50 disabled:cursor-not-allowed
    hover:border-gray-600 hover:bg-gray-800/70
    focus:outline-none focus:border-indigo-500/70 focus:ring-2 focus:ring-indigo-500/20 focus:bg-gray-800/80
    transition-all duration-200
  `;

  return (
    <div className="mb-4 flex gap-3">
      <div className="flex-1">
        <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-gray-400">
          Language
        </label>
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          disabled={disabled}
          className={selectClass}
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.value} value={lang.value} className="bg-gray-800 text-gray-100">
              {lang.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1">
        <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-gray-400">
          Voice
        </label>
        <select
          value={voice}
          onChange={(e) => onVoiceChange(e.target.value)}
          disabled={disabled}
          className={selectClass}
        >
          {voices.map((v) => (
            <option key={v.id} value={v.id} className="bg-gray-800 text-gray-100">
              {v.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

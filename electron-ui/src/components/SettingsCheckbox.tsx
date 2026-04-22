interface SettingsCheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function SettingsCheckbox({ label, checked, onChange }: SettingsCheckboxProps) {
  return (
    <label className="group flex cursor-pointer select-none items-center gap-2">
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="h-4 w-4 rounded border border-gray-600 bg-gray-800/50 transition-all duration-200 group-hover:border-gray-500 peer-checked:border-indigo-500 peer-checked:bg-indigo-500 peer-focus:ring-2 peer-focus:ring-indigo-500/30" />
        <svg
          className="pointer-events-none absolute left-0.5 top-0.5 h-3 w-3 text-white opacity-0 transition-opacity peer-checked:opacity-100"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <span className="text-[11px] text-gray-400 transition-colors group-hover:text-gray-300">
        {label}
      </span>
    </label>
  );
}

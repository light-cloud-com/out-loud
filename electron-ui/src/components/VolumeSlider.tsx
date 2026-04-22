import { useRef, useCallback } from "react";

interface VolumeSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export function VolumeSlider({ value, onChange }: VolumeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const updateValue = useCallback(
    (clientY: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const y = clientY - rect.top;
      const pct = Math.round(Math.max(0, Math.min(100, 100 - (y / rect.height) * 100)));
      onChange(pct);
    },
    [onChange]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      updateValue(e.clientY);

      const handleMouseMove = (e: MouseEvent) => {
        if (isDragging.current) {
          updateValue(e.clientY);
        }
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [updateValue]
  );

  return (
    <div className="flex w-[36px] flex-col items-center self-stretch">
      <label className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gray-400">
        Vol
      </label>

      {/* Track container */}
      <div
        ref={trackRef}
        className="relative w-2 flex-1 cursor-pointer rounded-full bg-gray-700/50"
        onMouseDown={handleMouseDown}
      >
        {/* Fill level */}
        <div
          className="absolute bottom-0 left-0 right-0 rounded-full bg-gradient-to-t from-indigo-500 to-indigo-400 transition-all duration-75"
          style={{ height: `${value}%` }}
        />

        {/* Thumb */}
        <div
          className="absolute left-1/2 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-indigo-400 bg-white shadow-md shadow-black/30 transition-all duration-75"
          style={{ bottom: `calc(${value}% - 10px)` }}
        />
      </div>

      <span className="pt-2 text-[10px] font-medium tabular-nums text-gray-400">{value}%</span>
    </div>
  );
}

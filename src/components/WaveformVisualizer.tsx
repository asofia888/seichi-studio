import React from 'react';

interface WaveformVisualizerProps {
  waveform?: number[];
  color: string;
  volume?: number;
  isDucked?: boolean;
  duckVolume?: number;
  className?: string;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  waveform,
  color,
  volume = 1.0,
  isDucked = false,
  duckVolume = 0.25,
  className = '',
}) => {
  // If no waveform provided, generate 40 bars fallback
  const peaks = waveform && waveform.length > 0 ? waveform : [
    0.4, 0.6, 0.8, 0.5, 0.3, 0.7, 0.9, 0.6, 0.4, 0.2, 0.5, 0.8, 0.7, 0.4,
    0.3, 0.6, 0.8, 0.9, 0.5, 0.4, 0.7, 0.8, 0.6, 0.3, 0.5, 0.7, 0.6, 0.4,
  ];

  const effectiveVolMultiplier = isDucked ? (duckVolume ?? 0.25) * volume : volume;

  return (
    <div className={`flex items-center justify-between h-full w-full px-1 overflow-hidden pointer-events-none select-none opacity-80 ${className}`}>
      {peaks.map((peak, idx) => {
        // Height scaled by volume and ducking factor
        const scaledHeight = Math.max(12, Math.min(96, peak * effectiveVolMultiplier * 100));

        return (
          <div
            key={idx}
            className="flex-1 flex flex-col items-center justify-center h-full mx-[0.5px]"
          >
            {/* Mirrored vertical bar */}
            <div
              className="w-full rounded-full transition-all duration-150"
              style={{
                height: `${scaledHeight}%`,
                backgroundColor: color,
                opacity: isDucked ? 0.35 : 0.85,
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

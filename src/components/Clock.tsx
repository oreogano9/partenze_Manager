
import React, { useState, useEffect } from 'react';
import { formatTime } from '../utils/timeUtils';

export const Clock: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="font-mono text-xl font-bold tracking-wider text-white bg-black/40 px-4 py-2 rounded-lg border border-white/10 shadow-inner">
      {formatTime(time)}
    </div>
  );
};

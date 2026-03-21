
export const getMinutesToTarget = (std: string): number => {
  const stdDate = new Date(std);
  const targetDate = new Date(stdDate.getTime() - 45 * 60000);
  const now = new Date();
  return Math.floor((targetDate.getTime() - now.getTime()) / 60000);
};

export const getUrgencyColor = (minutesToSTD: number): string => {
  // Grey: Already departed (STD <= 0)
  // Green: > 90 minutes before STD
  // Orange: 60 minutes before STD
  // Red: 40 minutes before STD
  
  if (minutesToSTD <= 10) {
    return 'hsl(0, 0%, 40%)'; // Grey
  }
  
  if (minutesToSTD >= 90) {
    return 'hsl(142, 70%, 45%)'; // Green
  }
  
  if (minutesToSTD < 30) {
    // 10 (Grey: hsl(0, 0%, 40%)) -> 30 (Red: hsl(0, 84%, 60%))
    const ratio = (minutesToSTD - 10) / (30 - 10);
    const saturation = 84 * ratio;
    const lightness = 40 + 20 * ratio;
    return `hsl(0, ${saturation}%, ${lightness}%)`;
  }

  if (minutesToSTD <= 40) {
    return 'hsl(0, 84%, 60%)'; // Red
  }
  
  if (minutesToSTD >= 60) {
    // 90 (Green: 142) -> 60 (Orange: 35)
    const ratio = (minutesToSTD - 60) / (90 - 60);
    const hue = 35 + (142 - 35) * ratio;
    return `hsl(${hue}, 70%, 45%)`;
  } else {
    // 60 (Orange: 35) -> 40 (Red: 0)
    const ratio = (minutesToSTD - 40) / (60 - 40);
    const hue = 0 + (35 - 0) * ratio;
    return `hsl(${hue}, 80%, 50%)`;
  }
};

export const formatDuration = (minutes: number): string => {
  const absMinutes = Math.abs(minutes);
  const h = Math.floor(absMinutes / 60);
  const m = absMinutes % 60;
  const sign = minutes < 0 ? '+' : '-';
  
  if (h > 0) {
    return `${sign}${h}h${m}m`;
  }
  return `${sign}${m}m`;
};

export const formatTime = (date: Date): string => {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};

export const formatHHmm = (dateStr: string): string => {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

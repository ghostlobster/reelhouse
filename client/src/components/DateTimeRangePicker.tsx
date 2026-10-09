import React, { useState, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  ChevronLeft,
  ChevronRight,
  Zap,
  BookmarkCheck,
  RotateCcw,
} from 'lucide-react';
import { formatDate } from '../utils/formatters';

interface DateTimeRangePickerProps {
  startDate: Date | null;
  endDate: Date | null;
  onChange: (start: Date, end: Date) => void;
  checkpointTimestamp?: number;
}

export const DateTimeRangePicker: React.FC<DateTimeRangePickerProps> = ({
  startDate,
  endDate,
  onChange,
  checkpointTimestamp,
}) => {
  // Calendar current viewed month (defaults to end date month or current month)
  const [viewDate, setViewDate] = useState<Date>(() => {
    return endDate ? new Date(endDate) : new Date();
  });

  // Intermediate selection tracking
  const [pickingStage, setPickingStage] = useState<'start' | 'end'>('start');
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  // Time inputs (HH and MM)
  const [startHour, setStartHour] = useState<number>(() => startDate ? startDate.getHours() : 0);
  const [startMinute, setStartMinute] = useState<number>(() => startDate ? startDate.getMinutes() : 0);
  const [endHour, setEndHour] = useState<number>(() => endDate ? endDate.getHours() : 23);
  const [endMinute, setEndMinute] = useState<number>(() => endDate ? endDate.getMinutes() : 59);

  // Sync internal times when props change
  useEffect(() => {
    if (startDate) {
      setStartHour(startDate.getHours());
      setStartMinute(startDate.getMinutes());
    }
    if (endDate) {
      setEndHour(endDate.getHours());
      setEndMinute(endDate.getMinutes());
    }
  }, [startDate, endDate]);

  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();

  const prevMonth = () => {
    setViewDate(new Date(viewYear, viewMonth - 1, 1));
  };

  const nextMonth = () => {
    setViewDate(new Date(viewYear, viewMonth + 1, 1));
  };

  // Generate calendar days for current viewMonth
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const calendarDays: Array<{
    date: Date;
    isCurrentMonth: boolean;
    dayNum: number;
  }> = [];

  // Previous month trailing days
  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    const d = new Date(viewYear, viewMonth - 1, daysInPrevMonth - i);
    calendarDays.push({ date: d, isCurrentMonth: false, dayNum: daysInPrevMonth - i });
  }

  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(viewYear, viewMonth, i);
    calendarDays.push({ date: d, isCurrentMonth: true, dayNum: i });
  }

  // Next month leading days (fill up to 35 or 42 grid slots)
  const remainingSlots = (7 - (calendarDays.length % 7)) % 7;
  for (let i = 1; i <= remainingSlots; i++) {
    const d = new Date(viewYear, viewMonth + 1, i);
    calendarDays.push({ date: d, isCurrentMonth: false, dayNum: i });
  }

  const isSameDay = (d1: Date | null, d2: Date | null) => {
    if (!d1 || !d2) return false;
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  const isBetweenDays = (date: Date, start: Date | null, end: Date | null) => {
    if (!start || !end) return false;
    const startZero = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const endZero = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    const curZero = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    return curZero > Math.min(startZero, endZero) && curZero < Math.max(startZero, endZero);
  };

  const isToday = (date: Date) => {
    return isSameDay(date, new Date());
  };

  const isCheckpoint = (date: Date) => {
    if (!checkpointTimestamp) return false;
    return isSameDay(date, new Date(checkpointTimestamp));
  };

  const handleDayClick = (clickedDate: Date) => {
    if (pickingStage === 'start' || !startDate) {
      // Pick start date
      const newStart = new Date(clickedDate);
      newStart.setHours(startHour, startMinute, 0, 0);

      const newEnd = endDate && endDate >= newStart ? endDate : new Date(newStart);
      newEnd.setHours(endHour, endMinute, 59, 999);

      onChange(newStart, newEnd);
      setPickingStage('end');
    } else {
      // Pick end date
      let newStart = new Date(startDate);
      let newEnd = new Date(clickedDate);

      if (newEnd < newStart) {
        // Swap if clicked date is before start date
        const temp = newStart;
        newStart = newEnd;
        newEnd = temp;
      }

      newStart.setHours(startHour, startMinute, 0, 0);
      newEnd.setHours(endHour, endMinute, 59, 999);

      onChange(newStart, newEnd);
      setPickingStage('start');
    }
  };

  const handleTimeChange = (type: 'start' | 'end', h: number, m: number) => {
    if (type === 'start') {
      const safeH = Math.max(0, Math.min(23, h));
      const safeM = Math.max(0, Math.min(59, m));
      setStartHour(safeH);
      setStartMinute(safeM);
      if (startDate && endDate) {
        const newStart = new Date(startDate);
        newStart.setHours(safeH, safeM, 0, 0);
        onChange(newStart, endDate);
      }
    } else {
      const safeH = Math.max(0, Math.min(23, h));
      const safeM = Math.max(0, Math.min(59, m));
      setEndHour(safeH);
      setEndMinute(safeM);
      if (startDate && endDate) {
        const newEnd = new Date(endDate);
        newEnd.setHours(safeH, safeM, 59, 999);
        onChange(startDate, newEnd);
      }
    }
  };

  const setTimePreset = (type: 'start' | 'end', preset: 'startOfDay' | 'endOfDay' | 'now') => {
    if (preset === 'startOfDay') {
      handleTimeChange(type, 0, 0);
    } else if (preset === 'endOfDay') {
      handleTimeChange(type, 23, 59);
    } else if (preset === 'now') {
      const now = new Date();
      handleTimeChange(type, now.getHours(), now.getMinutes());
    }
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const effectiveEndHover = pickingStage === 'end' && hoverDate && startDate ? hoverDate : endDate;

  return (
    <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-inner space-y-5">
      {/* Calendar Header with Month/Year Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-bold text-white tracking-wide">
            {monthNames[viewMonth]} {viewYear}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={prevMonth}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Previous Month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewDate(new Date())}
            className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Next Month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Weekday Labels */}
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider select-none">
        <div>Su</div>
        <div>Mo</div>
        <div>Tu</div>
        <div>We</div>
        <div>Th</div>
        <div>Fr</div>
        <div>Sa</div>
      </div>

      {/* Interactive Calendar Days Grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((item, idx) => {
          const isStart = isSameDay(item.date, startDate);
          const isEnd = isSameDay(item.date, effectiveEndHover);
          const isInRange = isBetweenDays(item.date, startDate, effectiveEndHover);
          const isTodayDate = isToday(item.date);
          const hasCheckpoint = isCheckpoint(item.date);

          return (
            <button
              type="button"
              key={idx}
              onClick={() => handleDayClick(item.date)}
              onMouseEnter={() => setHoverDate(item.date)}
              onMouseLeave={() => setHoverDate(null)}
              className={`relative h-9 rounded-lg text-xs font-mono font-medium transition-all flex flex-col items-center justify-center ${
                !item.isCurrentMonth ? 'text-slate-600' : 'text-slate-200'
              } ${
                isStart || isEnd
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30 ring-2 ring-cyan-400/50 z-10'
                  : isInRange
                  ? 'bg-cyan-500/20 text-cyan-200 rounded-none'
                  : 'hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <span>{item.dayNum}</span>

              {/* Today indicator dot */}
              {isTodayDate && !isStart && !isEnd && (
                <span className="w-1 h-1 rounded-full bg-cyan-400 absolute bottom-1" />
              )}

              {/* Checkpoint indicator marker */}
              {hasCheckpoint && !isStart && !isEnd && (
                <span
                  title="Checkpoint Date"
                  className="w-1.5 h-1.5 rounded-full bg-amber-400 absolute top-1 right-1"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Selection stage hint */}
      <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800/80 pt-3">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          Click to select: <strong className="text-cyan-300 capitalize">{pickingStage} Date</strong>
        </span>

        {checkpointTimestamp && (
          <span className="flex items-center gap-1 text-[10px] text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Checkpoint Marker
          </span>
        )}
      </div>

      {/* Time Controls (Start Time & End Time) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800/80 pt-4">
        {/* Start Time Box */}
        <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              Start Time
            </span>
            <div className="flex items-center gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => setTimePreset('start', 'startOfDay')}
                className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
              >
                00:00
              </button>
              <button
                type="button"
                onClick={() => setTimePreset('start', 'now')}
                className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
              >
                Now
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono">
            <div className="flex-1">
              <label className="block text-[9px] text-slate-500 uppercase">Hour (0-23)</label>
              <input
                type="number"
                min={0}
                max={23}
                value={startHour.toString().padStart(2, '0')}
                onChange={(e) => handleTimeChange('start', parseInt(e.target.value, 10) || 0, startMinute)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
            <span className="text-slate-500 font-bold mt-3">:</span>
            <div className="flex-1">
              <label className="block text-[9px] text-slate-500 uppercase">Min (0-59)</label>
              <input
                type="number"
                min={0}
                max={59}
                value={startMinute.toString().padStart(2, '0')}
                onChange={(e) => handleTimeChange('start', startHour, parseInt(e.target.value, 10) || 0)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>
        </div>

        {/* End Time Box */}
        <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              End Time
            </span>
            <div className="flex items-center gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => setTimePreset('end', 'endOfDay')}
                className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
              >
                23:59
              </button>
              <button
                type="button"
                onClick={() => setTimePreset('end', 'now')}
                className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
              >
                Now
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono">
            <div className="flex-1">
              <label className="block text-[9px] text-slate-500 uppercase">Hour (0-23)</label>
              <input
                type="number"
                min={0}
                max={23}
                value={endHour.toString().padStart(2, '0')}
                onChange={(e) => handleTimeChange('end', parseInt(e.target.value, 10) || 0, endMinute)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
            <span className="text-slate-500 font-bold mt-3">:</span>
            <div className="flex-1">
              <label className="block text-[9px] text-slate-500 uppercase">Min (0-59)</label>
              <input
                type="number"
                min={0}
                max={59}
                value={endMinute.toString().padStart(2, '0')}
                onChange={(e) => handleTimeChange('end', endHour, parseInt(e.target.value, 10) || 0)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Selected Range Summary Bar */}
      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between text-xs font-mono text-slate-300 gap-2">
        <div className="flex items-center gap-2 truncate">
          <span className="text-slate-500">From:</span>
          <span className="text-cyan-300 font-bold">
            {startDate ? formatDate(startDate.getTime()) : '—'}
          </span>
          <span className="text-slate-500">→ To:</span>
          <span className="text-cyan-300 font-bold">
            {endDate ? formatDate(endDate.getTime()) : '—'}
          </span>
        </div>

        {startDate && endDate && (
          <div className="text-[11px] text-slate-400 font-sans">
            {Math.max(
              1,
              Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24))
            )}{' '}
            days selected
          </div>
        )}
      </div>
    </div>
  );
};

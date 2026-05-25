// Vertical widget rail anchored to the left edge of the window. Four
// hover-only icons, stacked. Click an icon to toggle the corresponding
// sheet. The rail stays in place when a sheet opens (the sheet sits to
// its right), so the layout never reflows.

import { motion, useReducedMotion } from 'framer-motion';
import { Bell, BarChart3, Newspaper, Cloud, Shirt } from 'lucide-react';
import { LucideIcon } from 'lucide-react';
import { RefObject, useState } from 'react';

import { SheetKey } from '../hooks/useSheet';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface WidgetRailProps {
  activeWidget: SheetKey | null;
  onToggle: (key: SheetKey) => void;
  remindersCount: number;
  stocksDayPct: number | null;
  triggerRefs?: Partial<Record<SheetKey, RefObject<HTMLButtonElement | null>>>;
}

export function WidgetRail({
  activeWidget,
  onToggle,
  remindersCount,
  stocksDayPct,
  triggerRefs,
}: WidgetRailProps) {
  const reduce = useReducedMotion() ?? false;
  return (
    <motion.div
      // `y: '-50%'` is part of the animated transform so framer-motion
      // doesn't clobber the inline `translateY(-50%)` we used to use
      // for vertical centering. Without this fix the rail's TOP
      // anchored at 50% (not its CENTER), and the SheetPanel's
      // icon-offset alignment was off by ~half the rail's height.
      initial={reduce
        ? { opacity: 0, y: '-50%' }
        : { opacity: 0, x: -8, y: '-50%' }}
      animate={{ opacity: 1, x: 0, y: '-50%' }}
      transition={{ duration: 0.5, delay: 0.4, ease: EASE_OUT_EXPO }}
      style={{
        position: 'absolute',
        left: 14,
        top: '50%',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        zIndex: 30,
      }}
    >
      <RailIcon
        icon={Bell}
        label="Reminders"
        active={activeWidget === 'reminders'}
        onClick={() => onToggle('reminders')}
        badgeText={remindersCount > 0 ? String(remindersCount) : null}
        badgeTone="neutral"
        triggerRef={triggerRefs?.reminders}
      />
      <RailIcon
        icon={BarChart3}
        label="Stocks"
        active={activeWidget === 'stocks'}
        onClick={() => onToggle('stocks')}
        badgeText={stocksDayPct == null ? null : formatStocksBadge(stocksDayPct)}
        badgeTone={stocksDayPct == null ? 'neutral' : stocksDayPct >= 0 ? 'up' : 'down'}
        triggerRef={triggerRefs?.stocks}
      />
      <RailIcon
        icon={Newspaper}
        label="Headlines"
        active={activeWidget === 'news'}
        onClick={() => onToggle('news')}
        triggerRef={triggerRefs?.news}
      />
      <RailIcon
        icon={Cloud}
        label="Weather"
        active={activeWidget === 'weather'}
        onClick={() => onToggle('weather')}
        triggerRef={triggerRefs?.weather}
      />
      <RailIcon
        icon={Shirt}
        label="Customization"
        active={activeWidget === 'wardrobe'}
        onClick={() => onToggle('wardrobe')}
        triggerRef={triggerRefs?.wardrobe}
      />
    </motion.div>
  );
}

interface RailIconProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  badgeText?: string | null;
  badgeTone?: 'up' | 'down' | 'neutral';
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

function RailIcon({
  icon: Icon,
  label,
  active,
  onClick,
  badgeText,
  badgeTone = 'neutral',
  triggerRef,
}: RailIconProps) {
  const [hover, setHover] = useState(false);
  // Hover always expands the pill leftward and reveals the label.
  // The active state is a separate tint and not coupled to whether
  // any sheet is open elsewhere — rail behavior stays consistent.
  const reveal = hover && !active;
  const surfaceOn = hover || active;

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'flex-start',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <motion.button
        ref={triggerRef ?? undefined}
        type="button"
        whileTap={{ scale: 0.94 }}
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        data-sheet-trigger
        className="glass-btn"
        style={{
          height: 38,
          // When the label slot is hidden, the pill is a tight 38×38
          // circle with the icon dead-centered. Hover-expand swaps to
          // a longer pill (justify-content: flex-start, padding 11).
          width: reveal ? 'auto' : 38,
          minWidth: 38,
          padding: reveal ? '0 12px 0 12px' : 0,
          borderRadius: 19,
          background: active
            ? 'rgba(255, 255, 255, 0.18)'
            : surfaceOn
              ? 'var(--glass-bg-hover)'
              : 'transparent',
          border: `1px solid ${
            active
              ? 'rgba(255, 255, 255, 0.35)'
              : surfaceOn
                ? 'var(--glass-border-focus)'
                : 'transparent'
          }`,
          color: active ? '#ffffff' : 'var(--text-primary)',
          backdropFilter: surfaceOn ? 'var(--glass-blur)' : 'none',
          WebkitBackdropFilter: surfaceOn ? 'var(--glass-blur)' : 'none',
          boxShadow: surfaceOn
            ? '0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 14px rgba(0,0,0,0.30)'
            : 'none',
          filter: surfaceOn ? 'none' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: reveal ? 'flex-start' : 'center',
          gap: reveal ? 8 : 0,
          flexDirection: 'row',
          cursor: 'pointer',
          transition:
            'background 0.2s var(--ease-out-quart), border-color 0.2s var(--ease-out-quart), color 0.2s var(--ease-out-quart), filter 0.2s var(--ease-out-quart), padding 0.2s var(--ease-out-quart), width 0.22s var(--ease-out-quart)',
        }}
      >
        {/* Icon wrapper anchors the badge to the icon's screen
            position, so the badge follows the icon when the pill
            expands leftward on hover. */}
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <Icon size={17} strokeWidth={2} />
          {badgeText && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                top: -7,
                right: -8,
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                borderRadius: 8,
                background:
                  badgeTone === 'up'
                    ? 'color-mix(in srgb, var(--live) 28%, rgba(0,0,0,0.65))'
                    : badgeTone === 'down'
                      ? 'color-mix(in srgb, var(--accent) 28%, rgba(0,0,0,0.65))'
                      : 'rgba(0, 0, 0, 0.7)',
                border: `1px solid ${
                  badgeTone === 'up'
                    ? 'var(--live)'
                    : badgeTone === 'down'
                      ? 'var(--accent)'
                      : 'rgba(255,255,255,0.18)'
                }`,
                color:
                  badgeTone === 'up'
                    ? 'var(--live)'
                    : badgeTone === 'down'
                      ? 'var(--accent)'
                      : 'var(--text-primary)',
                fontSize: 9.5,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
                pointerEvents: 'none',
              }}
            >
              {badgeText}
            </span>
          )}
        </span>

        {/* Label only renders when the pill is expanded — when
            collapsed we drop it from flex flow entirely so the
            surrounding pill is a tight 38×38 circle with the icon
            in the dead center. */}
        {reveal && (
          <span
            style={{
              display: 'inline-block',
              overflow: 'hidden',
              maxWidth: 110,
              opacity: 1,
              whiteSpace: 'nowrap',
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: '0.02em',
              color: 'var(--text-primary)',
            }}
          >
            {label}
          </span>
        )}
      </motion.button>
    </div>
  );
}

function formatStocksBadge(pct: number): string {
  if (!Number.isFinite(pct)) return '';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

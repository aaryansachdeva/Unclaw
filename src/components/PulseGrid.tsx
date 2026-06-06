// Radial-ripple loader shown beside function-call / activity labels
// ("thinking", "browsing", ...). The SVG markup below is the design source
// VERBATIM. The only substitutions applied at render are:
//   #C44444   -> var(--pg-on)   (active = the live accent, recolors with it)
//   #611F1F33 -> var(--pg-off)  (inactive = darker active at 20% alpha)
//   svg-bloom -> unique id      (so multiple instances don't collide)
//   width/height -> the `size` prop
// At the default accent (#c44444) --pg-off resolves to ~#611F1F33, so it is
// pixel-identical to the original; change the accent and both colors follow.

import { useId, useMemo } from 'react';

const RAW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="92" height="92" viewBox="0 0 92 92">
  <defs>
    <filter id="svg-bloom" x="-100%" y="-100%" width="300%" height="300%">
      <feComponentTransfer in="SourceGraphic" result="bright">
        <feFuncR type="linear" slope="4.80" intercept="-1.20"/>
        <feFuncG type="linear" slope="4.80" intercept="-1.20"/>
        <feFuncB type="linear" slope="4.80" intercept="-1.20"/>
      </feComponentTransfer>
      <feGaussianBlur in="bright" stdDeviation="6.0" result="bloomSmall"/>
      <feGaussianBlur in="bright" stdDeviation="12.0" result="bloomLarge"/>
      <feMerge result="bloomMerge">
        <feMergeNode in="bloomLarge"/>
        <feMergeNode in="bloomSmall"/>
      </feMerge>
      <feBlend in="SourceGraphic" in2="bloomMerge" mode="screen"/>
    </filter>
  </defs>
  <!-- Off cells -->
  <g>
  <rect x="0" y="0" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="19" y="0" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="38" y="0" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="57" y="0" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="76" y="0" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="0" y="19" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="19" y="19" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="38" y="19" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="57" y="19" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="76" y="19" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="0" y="38" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="19" y="38" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="38" y="38" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="57" y="38" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="76" y="38" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="0" y="57" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="19" y="57" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="38" y="57" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="57" y="57" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="76" y="57" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="0" y="76" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="19" y="76" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="38" y="76" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="57" y="76" width="16" height="16" rx="2" fill="#611F1F33"/>
  <rect x="76" y="76" width="16" height="16" rx="2" fill="#611F1F33"/>
  </g>
  <!-- On cells with animation -->
  <g filter="url(#svg-bloom)">
  <rect x="0" y="0" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.500;0.371;0.250;0.146;0.067;0.017;0.000;0.017;0.067;0.146;0.250;0.371;0.500;0.629;0.750;0.854;0.933;0.983;1.000;0.983;0.933;0.854;0.750;0.629" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="19" y="0" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.256;0.377;0.507;0.636;0.756;0.858;0.936;0.985;1.000;0.981;0.930;0.849;0.744;0.623;0.493;0.364;0.244;0.142;0.064;0.015;0.000;0.019;0.070;0.151" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="38" y="0" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.757;0.859;0.937;0.985;1.000;0.981;0.929;0.848;0.743;0.622;0.492;0.363;0.243;0.141;0.063;0.015;0.000;0.019;0.071;0.152;0.257;0.378;0.508;0.637" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="57" y="0" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.256;0.377;0.507;0.636;0.756;0.858;0.936;0.985;1.000;0.981;0.930;0.849;0.744;0.623;0.493;0.364;0.244;0.142;0.064;0.015;0.000;0.019;0.070;0.151" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="76" y="0" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.500;0.371;0.250;0.146;0.067;0.017;0.000;0.017;0.067;0.146;0.250;0.371;0.500;0.629;0.750;0.854;0.933;0.983;1.000;0.983;0.933;0.854;0.750;0.629" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="0" y="19" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.256;0.377;0.507;0.636;0.756;0.858;0.936;0.985;1.000;0.981;0.930;0.849;0.744;0.623;0.493;0.364;0.244;0.142;0.064;0.015;0.000;0.019;0.070;0.151" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="19" y="19" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.500;0.371;0.250;0.146;0.067;0.017;0.000;0.017;0.067;0.146;0.250;0.371;0.500;0.629;0.750;0.854;0.933;0.983;1.000;0.983;0.933;0.854;0.750;0.629" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="38" y="19" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.018;0.069;0.149;0.253;0.374;0.504;0.633;0.753;0.856;0.935;0.984;1.000;0.982;0.931;0.851;0.747;0.626;0.496;0.367;0.247;0.144;0.065;0.016;0.000" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="57" y="19" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.500;0.371;0.250;0.146;0.067;0.017;0.000;0.017;0.067;0.146;0.250;0.371;0.500;0.629;0.750;0.854;0.933;0.983;1.000;0.983;0.933;0.854;0.750;0.629" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="76" y="19" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.256;0.377;0.507;0.636;0.756;0.858;0.936;0.985;1.000;0.981;0.930;0.849;0.744;0.623;0.493;0.364;0.244;0.142;0.064;0.015;0.000;0.019;0.070;0.151" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="0" y="38" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.757;0.859;0.937;0.985;1.000;0.981;0.929;0.848;0.743;0.622;0.492;0.363;0.243;0.141;0.063;0.015;0.000;0.019;0.071;0.152;0.257;0.378;0.508;0.637" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="19" y="38" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.018;0.069;0.149;0.253;0.374;0.504;0.633;0.753;0.856;0.935;0.984;1.000;0.982;0.931;0.851;0.747;0.626;0.496;0.367;0.247;0.144;0.065;0.016;0.000" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="38" y="38" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.500;0.371;0.250;0.146;0.067;0.017;0.000;0.017;0.067;0.146;0.250;0.371;0.500;0.629;0.750;0.854;0.933;0.983;1.000;0.983;0.933;0.854;0.750;0.629" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="57" y="38" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.018;0.069;0.149;0.253;0.374;0.504;0.633;0.753;0.856;0.935;0.984;1.000;0.982;0.931;0.851;0.747;0.626;0.496;0.367;0.247;0.144;0.065;0.016;0.000" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="76" y="38" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.757;0.859;0.937;0.985;1.000;0.981;0.929;0.848;0.743;0.622;0.492;0.363;0.243;0.141;0.063;0.015;0.000;0.019;0.071;0.152;0.257;0.378;0.508;0.637" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="0" y="57" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.256;0.377;0.507;0.636;0.756;0.858;0.936;0.985;1.000;0.981;0.930;0.849;0.744;0.623;0.493;0.364;0.244;0.142;0.064;0.015;0.000;0.019;0.070;0.151" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="19" y="57" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.500;0.371;0.250;0.146;0.067;0.017;0.000;0.017;0.067;0.146;0.250;0.371;0.500;0.629;0.750;0.854;0.933;0.983;1.000;0.983;0.933;0.854;0.750;0.629" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="38" y="57" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.018;0.069;0.149;0.253;0.374;0.504;0.633;0.753;0.856;0.935;0.984;1.000;0.982;0.931;0.851;0.747;0.626;0.496;0.367;0.247;0.144;0.065;0.016;0.000" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="57" y="57" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.500;0.371;0.250;0.146;0.067;0.017;0.000;0.017;0.067;0.146;0.250;0.371;0.500;0.629;0.750;0.854;0.933;0.983;1.000;0.983;0.933;0.854;0.750;0.629" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="76" y="57" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.256;0.377;0.507;0.636;0.756;0.858;0.936;0.985;1.000;0.981;0.930;0.849;0.744;0.623;0.493;0.364;0.244;0.142;0.064;0.015;0.000;0.019;0.070;0.151" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="0" y="76" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.500;0.371;0.250;0.146;0.067;0.017;0.000;0.017;0.067;0.146;0.250;0.371;0.500;0.629;0.750;0.854;0.933;0.983;1.000;0.983;0.933;0.854;0.750;0.629" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="19" y="76" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.256;0.377;0.507;0.636;0.756;0.858;0.936;0.985;1.000;0.981;0.930;0.849;0.744;0.623;0.493;0.364;0.244;0.142;0.064;0.015;0.000;0.019;0.070;0.151" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="38" y="76" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.757;0.859;0.937;0.985;1.000;0.981;0.929;0.848;0.743;0.622;0.492;0.363;0.243;0.141;0.063;0.015;0.000;0.019;0.071;0.152;0.257;0.378;0.508;0.637" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="57" y="76" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.256;0.377;0.507;0.636;0.756;0.858;0.936;0.985;1.000;0.981;0.930;0.849;0.744;0.623;0.493;0.364;0.244;0.142;0.064;0.015;0.000;0.019;0.070;0.151" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  <rect x="76" y="76" width="16" height="16" rx="2" fill="#C44444">
    <animate attributeName="opacity" values="0.500;0.371;0.250;0.146;0.067;0.017;0.000;0.017;0.067;0.146;0.250;0.371;0.500;0.629;0.750;0.854;0.933;0.983;1.000;0.983;0.933;0.854;0.750;0.629" dur="1.000s" repeatCount="indefinite"/>
  </rect>
  </g>
</svg>`;

export interface PulseGridProps {
  /** Rendered size in px (square). Default 16. */
  size?: number;
  /** Active color. Default the live accent; inactive is derived from it. */
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function PulseGrid({ size = 16, color = 'var(--accent)', className, style }: PulseGridProps) {
  const uid = useId().replace(/:/g, '');
  // NB: `var()` does NOT resolve inside an SVG `fill` *attribute* (presentation
  // attributes aren't CSS). It only resolves as the `fill` CSS *property*. So
  // we move the fills onto a class + an injected <style> rule, and let the
  // --pg-on / --pg-off custom props (set on the wrapper) cascade in.
  const onCls = `pgon-${uid}`;
  const offCls = `pgoff-${uid}`;
  const html = useMemo(
    () =>
      RAW_SVG
        .replace('width="92" height="92"', `width="${size}" height="${size}"`)
        .replace(
          '<defs>',
          `<defs><style>.${onCls}{fill:var(--pg-on)}.${offCls}{fill:var(--pg-off)}</style>`,
        )
        .replace(/fill="#C44444"/g, `class="${onCls}"`)
        .replace(/fill="#611F1F33"/g, `class="${offCls}"`)
        .replace(/svg-bloom/g, `pg-${uid}`),
    [size, uid, onCls, offCls],
  );
  // Inactive = darker active at 20% alpha, derived purely from the accent.
  const off = 'color-mix(in srgb, color-mix(in srgb, var(--pg-on) 50%, #000) 20%, transparent)';
  return (
    <span
      className={className}
      style={{
        ['--pg-on' as string]: color,
        ['--pg-off' as string]: off,
        display: 'inline-flex',
        lineHeight: 0,
        flex: '0 0 auto',
        ...style,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

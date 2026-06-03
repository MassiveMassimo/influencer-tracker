// Low-precision solar position (NOAA approximation, accurate to ~0.01°).
// Used only to pick OG background theme by real day/night — no exact times needed.

export const NYC = {
  lat: Number(process.env.OG_LAT ?? 40.7128),
  lng: Number(process.env.OG_LNG ?? -74.006),
};

/** Sun's altitude above the horizon, in degrees, at `date` for the given location. */
export function solarAltitudeDeg(date: Date, lat: number, lng: number): number {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86_400_000 + 2_440_587.5; // Julian date
  const n = jd - 2_451_545.0; // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360; // mean longitude (deg)
  const g = ((357.528 + 0.9856003 * n) % 360) * rad; // mean anomaly (rad)
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad; // ecliptic long
  const epsilon = 23.439 * rad; // obliquity of the ecliptic
  const delta = Math.asin(Math.sin(epsilon) * Math.sin(lambda)); // declination
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)); // right ascension
  const gmst = (280.46061837 + 360.98564736629 * n) % 360; // Greenwich mean sidereal time
  const ha = (gmst + lng) * rad - ra; // local hour angle
  const latR = lat * rad;
  const alt = Math.asin(
    Math.sin(latR) * Math.sin(delta) +
      Math.cos(latR) * Math.cos(delta) * Math.cos(ha),
  );
  return alt / rad;
}

/** True when the sun is above the horizon (−0.833° accounts for refraction + solar radius). */
export function isDaytime(date: Date, lat: number, lng: number): boolean {
  return solarAltitudeDeg(date, lat, lng) > -0.833;
}

export type OgTheme = "light" | "dark";

/** OG background theme for the moment `date` at the configured location (NYC default). */
export function ogTheme(date: Date = new Date(), loc = NYC): OgTheme {
  return isDaytime(date, loc.lat, loc.lng) ? "light" : "dark";
}

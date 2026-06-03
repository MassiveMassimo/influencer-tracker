// Generates the favicon / app-icon set from the shared app mark. Run once;
// outputs are committed static files under public/.
import { writeFileSync, rmSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { iconMarkSvg } from "../src/og/icon-mark";

function png(size: number): Buffer {
  return new Resvg(iconMarkSvg(size), { fitTo: { mode: "width", value: size } }).render().asPng();
}

writeFileSync("public/icon.svg", iconMarkSvg(64));
writeFileSync("public/icon-192.png", png(192));
writeFileSync("public/icon-512.png", png(512));
writeFileSync("public/apple-touch-icon.png", png(180));
// favicon.ico: browsers accept a PNG payload under the .ico name; ship a 48px PNG.
writeFileSync("public/favicon.ico", png(48));

// Drop Create-TanStack-App defaults.
for (const f of ["public/logo192.png", "public/logo512.png"]) {
  try {
    rmSync(f);
  } catch {}
}
console.log("icons written");

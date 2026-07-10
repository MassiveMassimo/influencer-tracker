// Static shape/radius tokens. FF ships a runtime radius switcher (ShapeProvider +
// "R" to cycle pill/rounded) built for its demo site — unused here, so only the
// fixed token set remains. Pill is the app's shape. Components that need a
// different radius (e.g. the rail's rounded-md nav pills) override locally.
export const shape = {
  item: "rounded-[20px]",
  bg: "rounded-[20px]",
  focusRing: "rounded-[22px]",
  container: "rounded-3xl",
  button: "rounded-[20px]",
} as const;

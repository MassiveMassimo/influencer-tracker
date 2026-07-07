// src/components/spinning-circular-text.tsx
// @ncdai spinning-circular-text (chanhdai.com/components/spinning-circular-text),
// adapted: cn import path. Credits: @jh3yy.
import { cn } from "#/lib/utils";

export type SpinningCircularTextProps = Omit<React.ComponentProps<"div">, "children"> & {
  text: string;
  /** @defaultValue 1 */
  charSpacing?: number;
  /** @defaultValue 1rem */
  fontSize?: string;
  /** Built-in CSS spin. Set false to hold the ring still and drive rotation
   *  externally (e.g. a motion transform on a wrapper). @defaultValue true */
  spin?: boolean;
  /** Class names applied to the spinning ring, e.g. duration-[10s]. */
  spinClassName?: string;
  /** Customize how each character is rendered; positioning is handled outside. */
  renderChar?: (char: string, index: number) => React.ReactNode;
};

export function SpinningCircularText({
  text,
  charSpacing = 1,
  fontSize = "1rem",
  spin = true,
  spinClassName,
  renderChar,
  className,
  style,
  ...props
}: SpinningCircularTextProps) {
  return (
    <div
      className={cn(
        "grid size-(--sc-container-size) place-items-center font-mono font-medium uppercase select-none",
        className,
      )}
      style={
        {
          "--sc-size": fontSize,
          "--sc-char-count": text.length,
          "--sc-char-spacing": charSpacing,
          "--sc-inner-angle": "calc((360 / var(--sc-char-count)) * 1deg)",
          "--sc-radius-factor": "calc(var(--sc-char-spacing) / sin(var(--sc-inner-angle)))",
          "--sc-radius": "calc(var(--sc-radius-factor) * -1ch)",
          "--sc-container-size": "calc(var(--sc-radius-factor) * var(--sc-size) * 2)",
          ...style,
        } as React.CSSProperties
      }
      {...props}
    >
      <div
        className={cn(
          "relative text-(size:--sc-size) leading-none",
          spin && "animate-spin-ccw",
          "*:absolute *:top-1/2 *:left-1/2 *:inline-block",
          "*:[--sc-char-rotate:calc(var(--sc-inner-angle)*var(--sc-char-index))]",
          "*:transform-[translate(-50%,-50%)_rotate(var(--sc-char-rotate))_translateY(var(--sc-radius))]",
          spinClassName,
        )}
        aria-hidden
      >
        {text.split("").map((char, index) => (
          <span key={index} style={{ "--sc-char-index": index } as React.CSSProperties}>
            {renderChar ? renderChar(char, index) : char}
          </span>
        ))}
      </div>
      <span className="sr-only">{text}</span>
    </div>
  );
}

# Fraunces grade subset

`fraunces-grade.woff2` comes from
`@fontsource-variable/fraunces@5.3.0/files/fraunces-latin-full-normal.woff2`.
It keeps only the grade characters `+`, `-`, `A`, `B`, `C`, `D`, and `F`.
The `opsz`, `wght`, `SOFT`, and `WONK` variable axes remain intact.

Recreate it with FontTools:

```sh
pyftsubset fraunces-latin-full-normal.woff2 \
  --output-file=fraunces-grade.woff2 \
  --unicodes=U+002B,U+002D,U+0041-0044,U+0046 \
  --flavor=woff2
```

The source package is available from
<https://www.npmjs.com/package/@fontsource-variable/fraunces/v/5.3.0>.
The deployed license is at `/licenses/Fraunces-OFL.txt`.

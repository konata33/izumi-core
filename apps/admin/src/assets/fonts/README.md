# Local authentication fonts

The Admin authentication entrance distributes these fonts locally and does not
load a font CDN:

- Instrument Sans Variable — source:
  <https://github.com/Instrument/instrument-sans>; license: SIL Open Font
  License 1.1.
- Noto Sans SC Variable — source:
  <https://github.com/notofonts/noto-cjk>; license: SIL Open Font License 1.1.

`instrument-sans-variable.woff2` retains the complete variable font.
`noto-sans-sc-variable.woff2` is generated with FontTools from the Admin source
corpus so that the application does not ship the multi-megabyte complete CJK
font. Characters outside this UI subset fall through to the system sans-serif
font stack.

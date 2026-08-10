/**
 * Cache-miss placeholder — a 245×337 card-shaped WebP ("? / no image"), embedded
 * as base64 so it needs no on-disk file (the cache tree and *.webp are gitignored)
 * and no runtime image tooling. Served on a miss with a SHORT cache lifetime so
 * the real art is picked up once the asset warms.
 *
 * Shared by both tiers (apps/images re-exports it): the self-host read path never
 * proxies upstream (ARCHITECTURE §7.5) so a miss is instant and local; the cloud
 * tier fills on demand and only falls back here when there is nothing to fill
 * from. Either way an image URL answers with an IMAGE — never an HTML shell.
 */
const PLACEHOLDER_B64 =
  'UklGRgwEAABXRUJQVlA4IAAEAAAQLgCdASr1AFEBPm02lUkkIyGhIpG5sIANiWlu4XdhCPOE9NuGfcCmjqqe5V9oCifwGD7myG/JFM3fLeNHykrc2Crd6YuST3CUfb2AGySW30uP1Ncvz2f5dVXf3K4nSmNn5dVXf3K4nSqusOxGtDD2ozvNqB+xw7Kiu5HXoMek29BPLtjU3oMek21+fNWTX4POaizsRnyEK8b22KBQpt6wX2D4FAnHYP3Q3aXXIMX8iALKfnHs/xzQiAAS9p5DVcAKsmidL+jBT6pNvVys6tqnDJcwfCbVn9FtV/5dYCSRXe73WFbk/Xv5UczEQvjR+IpOdP080D2KBQpt6w5/wK79GCn1Sber8qK79GCn1Sber8qK79GCn1Sber8qK79GCn1Sba9YMWzKzRx8rrhHG1AC2uJq0DqOTrLXbhbm/JazxgLsprv0MVWg9EwLcn68QNN0Se2fl2JTy7YqJ3xDqC+knxCYgCE6nahqdgIflAqq0Jrv7llRXf3KwAD+/diaH5f4Tdh30xs2CdLBgviY5bozTIxQLIlGmCDCk7I0R6WFo35ggElEmuO5D7iE5uPgBHn+eYEAB+k7nyIHDPL7OToccOgn7CjR6cO/3qvRoEgWTmmDrT4I+ME8ZlgRvnpxSjEGEIwhBkXpkvK/GzsMlA9vdEmxkSSaUrQkFJs1++Ov+OyN34nIMvXhZlUq362yddFVpSxENYGhT7yRqFFjVtT6q0YoD6kDWdjvOIbd03hUz0KRuSGbV07kMvD/i3ukMdK3wdldAf+bTirV9ChPXTExwimgBOtAFzamLWb39wQAFz4kvwGXuKNVTCx0vD0NdnwDl+OixlZ+cVeuIlf1wMJC8so/hkJgJiva1t7sigzJa5HkHsMKMky0Y+gvTAbiOQk/Gxl/ftwk0nU6APn0yc6zwyKIFqMzJgdZZ1ji1OhcdtE1bEAArAAAAAET35Fs/HrcJiLNgrxWKDxdKzwBUGgy/PhgSB9aWS85aJi1lZsnDr3J7Zopq4SyTv1hzQcFip03UB8jnnNOJ7tugQUZJ3S6xQo3xLpHqy3KYnVlGvOeJk7kYPH/n9mtDTdCs/ZhsI0AmdeoJKY59aDv06te0f4qNblRiwa0sDhttvccTntrj38QAfGKMqPC3nN694SHC/7sB+PDGA/3VZBmoqA+SP57LU2vzNADBfABp/+MH6LlnUBolK+J3dZ0Q/hwBu++BCiRT4mqfaqFN3LSH7B/6e2uir3i2CiQoLCJM9/zCVr5mkY8a6QHNz+94Tsnf+eOiLLGkopzSaeil5xeU0iGxqQIdWufQyVyjO70iMrKP3EP1OMBSIAAcjQzLQpN07qeiMi6nojH5uPHLf1EigAAAAAA';

export const PLACEHOLDER_WEBP: Buffer = Buffer.from(PLACEHOLDER_B64, 'base64');
export const PLACEHOLDER_CONTENT_TYPE = 'image/webp';

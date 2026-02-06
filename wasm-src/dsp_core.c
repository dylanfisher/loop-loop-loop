#include <stddef.h>
#include <stdint.h>

#if defined(__wasm__)
#define WASM_EXPORT __attribute__((visibility("default")))
#else
#define WASM_EXPORT
#endif

extern unsigned char __heap_base;
static uint32_t g_heap_ptr = 0;

WASM_EXPORT void *malloc(size_t bytes) {
  if (bytes == 0) return (void *)0;
  if (g_heap_ptr == 0) g_heap_ptr = (uint32_t)(uintptr_t)&__heap_base;
  const uint32_t aligned = (uint32_t)((bytes + 7u) & ~7u);
  const uint32_t ptr = g_heap_ptr;
  g_heap_ptr += aligned;
  return (void *)(uintptr_t)ptr;
}

WASM_EXPORT void free(void *ptr) { (void)ptr; }

WASM_EXPORT int dsp_fft_f32(
    float *fft_buffer,
    int fft_frame_size,
    int sign,
    int normalize_inverse,
    const int *bitrev_pairs,
    int bitrev_pair_count,
    const float *twiddle_re,
    const float *twiddle_im,
    int twiddle_count) {
  if (!fft_buffer || !bitrev_pairs || !twiddle_re || !twiddle_im || fft_frame_size <= 1 ||
      bitrev_pair_count < 0 || twiddle_count <= 0) {
    return 0;
  }
  if (sign != -1 && sign != 1) return 0;

  for (int p = 0; p < bitrev_pair_count; p += 1) {
    const int a = bitrev_pairs[2 * p];
    const int b = bitrev_pairs[2 * p + 1];
    if (a < 0 || b < 0 || a >= fft_frame_size || b >= fft_frame_size) return 0;
    const int ai = 2 * a;
    const int bi = 2 * b;
    const float re = fft_buffer[ai];
    const float im = fft_buffer[ai + 1];
    fft_buffer[ai] = fft_buffer[bi];
    fft_buffer[ai + 1] = fft_buffer[bi + 1];
    fft_buffer[bi] = re;
    fft_buffer[bi + 1] = im;
  }

  int tw_index = 0;
  for (int step = 2; step <= fft_frame_size; step <<= 1) {
    const int half = step >> 1;
    for (int m = 0; m < half; m += 1) {
      if (tw_index >= twiddle_count) return 0;
      const float wr = twiddle_re[tw_index];
      const float wi = (float)sign * twiddle_im[tw_index];
      tw_index += 1;
      for (int i = m; i < fft_frame_size; i += step) {
        const int j = i + half;
        const int ii = 2 * i;
        const int ji = 2 * j;
        const float tr = fft_buffer[ji] * wr - fft_buffer[ji + 1] * wi;
        const float ti = fft_buffer[ji] * wi + fft_buffer[ji + 1] * wr;
        fft_buffer[ji] = fft_buffer[ii] - tr;
        fft_buffer[ji + 1] = fft_buffer[ii + 1] - ti;
        fft_buffer[ii] += tr;
        fft_buffer[ii + 1] += ti;
      }
    }
  }

  if (sign == 1 && normalize_inverse != 0) {
    const float scale = 1.0f / (2.0f * (float)fft_frame_size);
    for (int i = 0; i < 2 * fft_frame_size; i += 1) {
      fft_buffer[i] *= scale;
    }
  }

  return 1;
}

WASM_EXPORT int dsp_window_to_complex_f32(
    const float *input,
    const float *window,
    float *fft_buffer,
    int win_size) {
  if (!input || !window || !fft_buffer || win_size <= 0) return 0;
  for (int i = 0; i < win_size; i += 1) {
    fft_buffer[2 * i] = input[i] * window[i];
    fft_buffer[2 * i + 1] = 0.0f;
  }
  return 1;
}

WASM_EXPORT int dsp_overlap_add_real_f32(
    const float *fft_buffer,
    const float *window,
    float *output_accum,
    float *out_block,
    int win_size,
    int hop_out,
    float window_scale,
    float out_gain) {
  if (!fft_buffer || !window || !output_accum || !out_block || win_size <= 0 || hop_out <= 0 ||
      hop_out > win_size) {
    return 0;
  }

  for (int i = 0; i < win_size; i += 1) {
    output_accum[i] += fft_buffer[2 * i] * window[i] * window_scale;
  }

  for (int i = 0; i < hop_out; i += 1) {
    out_block[i] = output_accum[i] * out_gain;
  }

  const int tail = win_size - hop_out;
  for (int i = 0; i < tail; i += 1) {
    output_accum[i] = output_accum[i + hop_out];
  }
  for (int i = tail; i < win_size; i += 1) {
    output_accum[i] = 0.0f;
  }
  return 1;
}

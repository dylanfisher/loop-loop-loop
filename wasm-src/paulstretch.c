#include <stddef.h>
#include <stdint.h>

#if defined(__wasm__)
#define WASM_EXPORT __attribute__((visibility("default")))
#else
#define WASM_EXPORT
#endif

extern unsigned char __heap_base;
static uint32_t g_heap_ptr = 0;

static float max_float(float a, float b) { return a > b ? a : b; }
static float clamp_float(float value, float min_value, float max_value) {
  if (value < min_value) return min_value;
  if (value > max_value) return max_value;
  return value;
}

static uint32_t next_u32(uint32_t *state) {
  uint32_t x = *state;
  if (x == 0) x = 0x6d2b79f5u;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  *state = x;
  return x;
}

static void random_unit_vec(uint32_t *rng_state, float *out_re, float *out_im) {
  const float inv_u32 = 1.0f / 4294967295.0f;
  float x = (float)next_u32(rng_state) * inv_u32 * 2.0f - 1.0f;
  float y = (float)next_u32(rng_state) * inv_u32 * 2.0f - 1.0f;
  float mag2 = x * x + y * y;
  if (mag2 < 1e-10f) {
    *out_re = 1.0f;
    *out_im = 0.0f;
    return;
  }
  const float inv_mag = 1.0f / __builtin_sqrtf(mag2);
  *out_re = x * inv_mag;
  *out_im = y * inv_mag;
}

static void normalize_or_default(float *re, float *im, float def_re, float def_im) {
  const float mag2 = (*re) * (*re) + (*im) * (*im);
  if (mag2 < 1e-12f) {
    *re = def_re;
    *im = def_im;
    return;
  }
  const float inv_mag = 1.0f / __builtin_sqrtf(mag2);
  *re *= inv_mag;
  *im *= inv_mag;
}

WASM_EXPORT void *malloc(size_t bytes) {
  if (bytes == 0) return (void *)0;
  if (g_heap_ptr == 0) g_heap_ptr = (uint32_t)(uintptr_t)&__heap_base;
  const uint32_t aligned = (uint32_t)((bytes + 7u) & ~7u);
  const uint32_t ptr = g_heap_ptr;
  g_heap_ptr += aligned;
  return (void *)(uintptr_t)ptr;
}

WASM_EXPORT void free(void *ptr) { (void)ptr; }

WASM_EXPORT int paulstretch_overlap_add_f32(
    const float *fft,
    const float *window,
    float *output_accum,
    float *out_block,
    int win_size,
    int hop_out,
    float gain) {
  if (!fft || !window || !output_accum || !out_block || win_size <= 0 || hop_out <= 0 ||
      hop_out > win_size) {
    return 0;
  }

  for (int i = 0; i < win_size; i += 1) {
    output_accum[i] += fft[2 * i] * window[i];
  }

  for (int i = 0; i < hop_out; i += 1) {
    out_block[i] = output_accum[i] * gain;
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

WASM_EXPORT int paulstretch_analyze_bins_f32(
    float *fft,
    float *last_magnitudes,
    float *phase_re,
    float *phase_im,
    const float *tilt_curve,
    int half_bins,
    float smooth_factor,
    float phase_randomness,
    uint32_t *rng_state) {
  if (!fft || !last_magnitudes || !phase_re || !phase_im || !tilt_curve || !rng_state ||
      half_bins <= 0) {
    return 0;
  }
  const float sf = clamp_float(smooth_factor, 0.0f, 1.0f);
  const float one_minus_sf = 1.0f - sf;
  const float rand_mix = clamp_float(phase_randomness, 0.0f, 1.0f);
  const float base_mix = 1.0f - rand_mix;

  for (int i = 0; i < half_bins; i += 1) {
    const float re = fft[2 * i];
    const float im = fft[2 * i + 1];
    const float mag = __builtin_sqrtf(max_float(0.0f, re * re + im * im));
    const float prev = last_magnitudes[i];
    const float smoothed = prev > 0.0f ? sf * prev + one_minus_sf * mag : mag;
    last_magnitudes[i] = smoothed;

    float base_re = re;
    float base_im = im;
    normalize_or_default(&base_re, &base_im, phase_re[i], phase_im[i]);
    normalize_or_default(&base_re, &base_im, 1.0f, 0.0f);
    phase_re[i] = base_re;
    phase_im[i] = base_im;

    float rand_re = 0.0f;
    float rand_im = 0.0f;
    random_unit_vec(rng_state, &rand_re, &rand_im);
    float mix_re = base_re * base_mix + rand_re * rand_mix;
    float mix_im = base_im * base_mix + rand_im * rand_mix;
    normalize_or_default(&mix_re, &mix_im, base_re, base_im);

    const float magn_tilted = smoothed * tilt_curve[i];
    fft[2 * i] = magn_tilted * mix_re;
    fft[2 * i + 1] = magn_tilted * mix_im;
  }

  return 1;
}

WASM_EXPORT int paulstretch_synthesize_bins_f32(
    float *fft,
    const float *magnitudes,
    const float *phase_re,
    const float *phase_im,
    const float *tilt_curve,
    int half_bins,
    float phase_randomness,
    uint32_t *rng_state) {
  if (!fft || !magnitudes || !phase_re || !phase_im || !tilt_curve || !rng_state ||
      half_bins <= 0) {
    return 0;
  }
  const float rand_mix = clamp_float(phase_randomness, 0.0f, 1.0f);
  const float base_mix = 1.0f - rand_mix;

  for (int i = 0; i < half_bins; i += 1) {
    float base_re = phase_re[i];
    float base_im = phase_im[i];
    normalize_or_default(&base_re, &base_im, 1.0f, 0.0f);

    float rand_re = 0.0f;
    float rand_im = 0.0f;
    random_unit_vec(rng_state, &rand_re, &rand_im);
    float mix_re = base_re * base_mix + rand_re * rand_mix;
    float mix_im = base_im * base_mix + rand_im * rand_mix;
    normalize_or_default(&mix_re, &mix_im, base_re, base_im);

    const float magn_tilted = magnitudes[i] * tilt_curve[i];
    fft[2 * i] = magn_tilted * mix_re;
    fft[2 * i + 1] = magn_tilted * mix_im;
  }
  return 1;
}

WASM_EXPORT int paulstretch_mirror_bins_f32(float *fft, int win_size, int half) {
  if (!fft || win_size <= 0 || half <= 1 || half > win_size) return 0;
  for (int i = 1; i < half; i += 1) {
    const int mirror = win_size - i;
    fft[2 * mirror] = fft[2 * i];
    fft[2 * mirror + 1] = -fft[2 * i + 1];
  }
  return 1;
}

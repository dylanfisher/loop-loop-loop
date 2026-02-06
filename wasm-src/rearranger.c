#include <stddef.h>
#include <stdint.h>

#if defined(__wasm__)
#define WASM_EXPORT __attribute__((visibility("default")))
#else
#define WASM_EXPORT
#endif

extern unsigned char __heap_base;
static uint32_t g_heap_ptr = 0;

typedef struct {
  int sample;
  float score;
} Candidate;

static int min_int(int a, int b) { return a < b ? a : b; }
static int max_int(int a, int b) { return a > b ? a : b; }

static int clamp_int(int value, int min_value, int max_value) {
  if (value < min_value) return min_value;
  if (value > max_value) return max_value;
  return value;
}

WASM_EXPORT void *malloc(size_t bytes) {
  if (bytes == 0) return (void *)0;
  if (g_heap_ptr == 0) g_heap_ptr = (uint32_t)(uintptr_t)&__heap_base;
  const uint32_t aligned = (uint32_t)((bytes + 7u) & ~7u);
  const uint32_t ptr = g_heap_ptr;
  g_heap_ptr += aligned;
  return (void *)(uintptr_t)ptr;
}

WASM_EXPORT void free(void *ptr) {
  (void)ptr;
}

WASM_EXPORT int rearrange_segment_f32(
    const float *input,
    float *output,
    const int *starts,
    const int *map_source,
    const unsigned char *map_reverse,
    int slice_count,
    int start_sample,
    int segment_length,
    int fade_samples) {
  if (!input || !output || !starts || !map_source || !map_reverse || slice_count <= 0 ||
      segment_length <= 0 || start_sample < 0) {
    return 0;
  }

  for (int i = 0; i < segment_length; i += 1) {
    output[i] = 0.0f;
  }

  int write_head = 0;
  const int safe_fade = max_int(0, fade_samples);

  for (int slice_index = 0; slice_index < slice_count; slice_index += 1) {
    int src_index = clamp_int(map_source[slice_index], 0, slice_count - 1);
    int src_start = clamp_int(starts[src_index], 0, segment_length);
    int src_end = clamp_int(starts[src_index + 1], 0, segment_length);
    if (src_end < src_start) {
      const int temp = src_start;
      src_start = src_end;
      src_end = temp;
    }
    const int src_len = max_int(0, src_end - src_start);
    if (src_len == 0) continue;

    const int dst_start = write_head;
    const int dst_end = min_int(segment_length, dst_start + src_len);
    const int dst_len = max_int(0, dst_end - dst_start);
    if (dst_len == 0) {
      write_head += src_len;
      if (write_head >= segment_length) break;
      continue;
    }

    const int slice_fade = min_int(safe_fade, dst_len / 2);
    const int reversed = map_reverse[slice_index] != 0;

    for (int i = 0; i < dst_len; i += 1) {
      int src_index_in_slice = i;
      if (src_index_in_slice > src_len - 1) src_index_in_slice = src_len - 1;
      const int read_index = reversed
                                 ? (start_sample + src_start + (src_len - 1 - src_index_in_slice))
                                 : (start_sample + src_start + src_index_in_slice);
      float gain = 1.0f;
      if (slice_fade > 0) {
        if (i < slice_fade) {
          gain = (float)i / (float)slice_fade;
        } else if (i >= dst_len - slice_fade) {
          gain = (float)(dst_len - 1 - i) / (float)slice_fade;
        }
      }
      output[dst_start + i] = input[read_index] * gain;
    }

    write_head += src_len;
    if (write_head >= segment_length) break;
  }

  return segment_length;
}

static void sort_candidates_by_score(Candidate *items, int length) {
  for (int i = 1; i < length; i += 1) {
    const Candidate key = items[i];
    int j = i - 1;
    while (j >= 0) {
      const int higher = items[j].score < key.score;
      const int same_score_later_sample =
          items[j].score == key.score && items[j].sample > key.sample;
      if (!higher && !same_score_later_sample) break;
      items[j + 1] = items[j];
      j -= 1;
    }
    items[j + 1] = key;
  }
}

static void sort_ints_asc(int *items, int length) {
  for (int i = 1; i < length; i += 1) {
    const int key = items[i];
    int j = i - 1;
    while (j >= 0 && items[j] > key) {
      items[j + 1] = items[j];
      j -= 1;
    }
    items[j + 1] = key;
  }
}

static int detect_regions_core(
    const float *input,
    int input_length,
    int sample_rate,
    int max_slices,
    int min_slice_duration_ms,
    int frame_duration_ms,
    float threshold_std_dev,
    float sensitivity,
    int channel_count,
    int interleaved,
    float *out_regions,
    int out_capacity) {
  if (!input || !out_regions || input_length <= 0 || sample_rate <= 0 || out_capacity < 2) {
    return 0;
  }
  if (channel_count <= 0) return 0;

  const int safe_max_slices = clamp_int(max_slices, 1, 128);
  const int max_internal = max_int(0, safe_max_slices - 1);
  if (max_internal <= 0) {
    out_regions[0] = 0.0f;
    out_regions[1] = 1.0f;
    return min_int(2, out_capacity);
  }

  const int frame_ms = clamp_int(frame_duration_ms, 4, 50);
  int frame_size = (sample_rate * frame_ms) / 1000;
  frame_size = clamp_int(frame_size, 16, input_length);
  int hop_size = max_int(8, frame_size / 2);
  if (input_length < frame_size) {
    out_regions[0] = 0.0f;
    out_regions[1] = 1.0f;
    return min_int(2, out_capacity);
  }

  const int frame_count = ((input_length - frame_size) / hop_size) + 1;
  if (frame_count <= 2) {
    out_regions[0] = 0.0f;
    out_regions[1] = 1.0f;
    return min_int(2, out_capacity);
  }

  float *envelope = (float *)malloc(sizeof(float) * (size_t)frame_count);
  float *deltas = (float *)malloc(sizeof(float) * (size_t)frame_count);
  Candidate *candidates =
      (Candidate *)malloc(sizeof(Candidate) * (size_t)frame_count);
  int *selected = (int *)malloc(sizeof(int) * (size_t)max_internal);
  if (!envelope || !deltas || !candidates || !selected) {
    return 0;
  }

  for (int frame_index = 0; frame_index < frame_count; frame_index += 1) {
    const int frame_start = frame_index * hop_size;
    float sum = 0.0f;
    if (interleaved) {
      for (int i = 0; i < frame_size; i += 1) {
        const int base = (frame_start + i) * channel_count;
        for (int ch = 0; ch < channel_count; ch += 1) {
          const float sample = input[base + ch];
          sum += sample * sample;
        }
      }
    } else {
      for (int i = 0; i < frame_size; i += 1) {
        const float sample = input[frame_start + i];
        sum += sample * sample;
      }
    }
    envelope[frame_index] = sum;
  }

  deltas[0] = 0.0f;
  float positive_sum = 0.0f;
  float positive_max = 0.0f;
  int positive_count = 0;
  for (int frame_index = 1; frame_index < frame_count; frame_index += 1) {
    const float delta = envelope[frame_index] - envelope[frame_index - 1];
    const float pos = delta > 0.0f ? delta : 0.0f;
    deltas[frame_index] = pos;
    if (pos > 0.0f) {
      positive_sum += pos;
      if (pos > positive_max) positive_max = pos;
      positive_count += 1;
    }
  }

  if (positive_count <= 0 || positive_max <= 0.0f) {
    out_regions[0] = 0.0f;
    out_regions[1] = 1.0f;
    return min_int(2, out_capacity);
  }

  const float mean = positive_sum / (float)positive_count;
  float variance_sum = 0.0f;
  for (int frame_index = 1; frame_index < frame_count; frame_index += 1) {
    const float pos = deltas[frame_index];
    if (pos <= 0.0f) continue;
    const float diff = pos - mean;
    variance_sum += diff * diff;
  }
  const float variance = variance_sum / (float)positive_count;
  const float approx_std = variance;
  const float safe_sensitivity = sensitivity < 0.0f ? 0.0f : (sensitivity > 1.0f ? 1.0f : sensitivity);
  const float threshold_bias = threshold_std_dev * (0.75f + 0.5f * (1.0f - safe_sensitivity));
  float threshold = mean + threshold_bias * approx_std;
  const float floor_threshold = positive_max * 0.05f;
  if (threshold < floor_threshold) threshold = floor_threshold;

  int candidate_count = 0;
  for (int frame_index = 1; frame_index < frame_count - 1; frame_index += 1) {
    const float d = deltas[frame_index];
    if (d < threshold) continue;
    if (d < deltas[frame_index - 1] || d < deltas[frame_index + 1]) continue;
    int sample = frame_index * hop_size + (frame_size / 2);
    sample = clamp_int(sample, 1, input_length - 1);
    candidates[candidate_count].sample = sample;
    candidates[candidate_count].score = d;
    candidate_count += 1;
  }

  if (candidate_count <= 0) {
    out_regions[0] = 0.0f;
    out_regions[1] = 1.0f;
    return min_int(2, out_capacity);
  }

  sort_candidates_by_score(candidates, candidate_count);

  const int min_gap_ms = max_int(20, min_slice_duration_ms);
  const int min_gap_samples = max_int(1, (sample_rate * min_gap_ms) / 1000);
  int selected_count = 0;
  for (int i = 0; i < candidate_count; i += 1) {
    if (selected_count >= max_internal) break;
    const int sample = candidates[i].sample;
    int far_enough = 1;
    for (int j = 0; j < selected_count; j += 1) {
      int diff = sample - selected[j];
      if (diff < 0) diff = -diff;
      if (diff < min_gap_samples) {
        far_enough = 0;
        break;
      }
    }
    if (!far_enough) continue;
    selected[selected_count] = sample;
    selected_count += 1;
  }

  if (selected_count > 1) sort_ints_asc(selected, selected_count);

  int out_count = 0;
  out_regions[out_count++] = 0.0f;
  for (int i = 0; i < selected_count && out_count < out_capacity - 1; i += 1) {
    out_regions[out_count++] = (float)selected[i] / (float)input_length;
  }
  if (out_count < out_capacity) {
    out_regions[out_count++] = 1.0f;
  } else {
    out_regions[out_capacity - 1] = 1.0f;
    out_count = out_capacity;
  }
  return out_count;
}

WASM_EXPORT int detect_regions_f32(
    const float *input,
    int input_length,
    int sample_rate,
    int max_slices,
    int min_slice_duration_ms,
    int frame_duration_ms,
    float threshold_std_dev,
    float sensitivity,
    float *out_regions,
    int out_capacity) {
  return detect_regions_core(
      input,
      input_length,
      sample_rate,
      max_slices,
      min_slice_duration_ms,
      frame_duration_ms,
      threshold_std_dev,
      sensitivity,
      1,
      0,
      out_regions,
      out_capacity);
}

WASM_EXPORT int detect_regions_interleaved_f32(
    const float *interleaved,
    int frame_count,
    int channel_count,
    int sample_rate,
    int max_slices,
    int min_slice_duration_ms,
    int frame_duration_ms,
    float threshold_std_dev,
    float sensitivity,
    float *out_regions,
    int out_capacity) {
  if (!interleaved || frame_count <= 0 || channel_count <= 0) return 0;
  return detect_regions_core(
      interleaved,
      frame_count,
      sample_rate,
      max_slices,
      min_slice_duration_ms,
      frame_duration_ms,
      threshold_std_dev,
      sensitivity,
      channel_count,
      1,
      out_regions,
      out_capacity);
}

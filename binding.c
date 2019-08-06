#include <assert.h>
#include <limits.h>
#include <math.h>
#include <node_api.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RESOURCE_NAME "@ronomon/reed-solomon"

#define OK(call)                                                               \
  assert((call) == napi_ok);

#define THROW(env, message)                                                    \
  do {                                                                         \
    napi_throw_error((env), NULL, (message));                                  \
    return NULL;                                                               \
  } while (0)

#define MAX_K 24
#define MAX_M 6
#define MAX_W 8

// Parameters for (k,m) found by `search()` are in PARAMETERS[k-1][m-1]:
// PARAMETERS[k-1][m-1] = k, m, w, p, x, y, b:
//
// k = The number of data shards.
// m = The number of parity shards.
// w = The Galois Field exponent. The smaller the exponent, the less bits.
// p = The primitive polynomial used to generate the Galois Field.
//
//     We do not use x or y when m <= 2:
// x = The column offset used to generate the matrix, -1 when m <= 2.
// y = The row offset used to generate the matrix, -1 when m <= 2.
//
// b = The number of bits in the resulting bit matrix.
static const int PARAMETERS[24][6][7] = {
  {
    {  1, 1, 2,   7,  -1,  -1,    2 },
    {  1, 2, 2,   7,  -1,  -1,    4 },
    {  1, 3, 2,   7,   0,   1,    6 },
    {  1, 4, 4,  19,   0,   1,   16 },
    {  1, 5, 4,  19,   0,   1,   20 },
    {  1, 6, 4,  19,   0,   1,   24 }
  },
  {
    {  2, 1, 2,   7,  -1,  -1,    4 },
    {  2, 2, 2,   7,  -1,  -1,    9 },
    {  2, 3, 4,  19,   0,   4,   28 },
    {  2, 4, 4,  19,   0,   5,   40 },
    {  2, 5, 4,  19,   2,   9,   51 },
    {  2, 6, 4,  19,   4,  10,   62 }
  },
  {
    {  3, 1, 2,   7,  -1,  -1,    6 },
    {  3, 2, 4,  19,  -1,  -1,   26 },
    {  3, 3, 4,  19,   0,   9,   44 },
    {  3, 4, 4,  19,   1,   8,   63 },
    {  3, 5, 4,  19,   1,   9,   82 },
    {  3, 6, 4,  19,   0,   9,  101 }
  },
  {
    {  4, 1, 4,  19,  -1,  -1,   16 },
    {  4, 2, 4,  19,  -1,  -1,   36 },
    {  4, 3, 4,  19,   0,   9,   63 },
    {  4, 4, 4,  19,   3,  11,   89 },
    {  4, 5, 4,  19,   3,  11,  116 },
    {  4, 6, 4,  19,  11,   4,  145 }
  },
  {
    {  5, 1, 4,  19,  -1,  -1,   20 },
    {  5, 2, 4,  19,  -1,  -1,   47 },
    {  5, 3, 4,  19,   4,  13,   82 },
    {  5, 4, 4,  19,   3,  12,  118 },
    {  5, 5, 4,  19,   0,   9,  152 },
    {  5, 6, 4,  19,   0,   9,  185 }
  },
  {
    {  6, 1, 4,  19,  -1,  -1,   24 },
    {  6, 2, 4,  19,  -1,  -1,   58 },
    {  6, 3, 4,  19,   2,  12,  102 },
    {  6, 4, 4,  19,   2,  12,  144 },
    {  6, 5, 4,  19,   0,   9,  186 },
    {  6, 6, 4,  19,   0,   9,  231 }
  },
  {
    {  7, 1, 4,  19,  -1,  -1,   28 },
    {  7, 2, 4,  19,  -1,  -1,   71 },
    {  7, 3, 4,  19,   1,  13,  123 },
    {  7, 4, 4,  19,   2,  12,  174 },
    {  7, 5, 4,  19,   0,   9,  226 },
    {  7, 6, 4,  19,   7,   0,  277 }
  },
  {
    {  8, 1, 4,  19,  -1,  -1,   32 },
    {  8, 2, 4,  19,  -1,  -1,   84 },
    {  8, 3, 4,  19,   2,  13,  142 },
    {  8, 4, 4,  19,   2,  12,  205 },
    {  8, 5, 4,  19,   0,   9,  265 },
    {  8, 6, 4,  19,   0,   8,  328 }
  },
  {
    {  9, 1, 4,  19,  -1,  -1,   36 },
    {  9, 2, 4,  19,  -1,  -1,   97 },
    {  9, 3, 4,  19,   1,  13,  162 },
    {  9, 4, 4,  19,   2,  12,  237 },
    {  9, 5, 4,  19,   0,   9,  308 },
    {  9, 6, 4,  19,   1,  10,  376 }
  },
  {
    { 10, 1, 4,  19,  -1,  -1,   40 },
    { 10, 2, 4,  19,  -1,  -1,  111 },
    { 10, 3, 4,  19,   1,  13,  186 },
    { 10, 4, 4,  19,   0,  12,  268 },
    { 10, 5, 4,  19,   0,  11,  347 },
    { 10, 6, 4,  19,   0,  10,  426 }
  },
  {
    { 11, 1, 4,  19,  -1,  -1,   44 },
    { 11, 2, 4,  19,  -1,  -1,  125 },
    { 11, 3, 4,  19,   0,  13,  211 },
    { 11, 4, 4,  19,   0,  12,  300 },
    { 11, 5, 4,  19,   0,  11,  390 },
    { 11, 6, 8, 135,  58, 188, 1401 }
  },
  {
    { 12, 1, 4,  19,  -1,  -1,   48 },
    { 12, 2, 4,  19,  -1,  -1,  139 },
    { 12, 3, 4,  19,   3,   0,  234 },
    { 12, 4, 4,  19,   0,  12,  334 },
    { 12, 5, 8, 113,  24, 208, 1269 },
    { 12, 6, 8, 135,  57, 188, 1577 }
  },
  {
    { 13, 1, 4,  19,  -1,  -1,   52 },
    { 13, 2, 4,  19,  -1,  -1,  155 },
    { 13, 3, 4,  19,   0,  13,  261 },
    { 13, 4, 8, 135,  59, 189, 1037 },
    { 13, 5, 8, 113,  27, 236, 1393 },
    { 13, 6, 8, 113,  27, 236, 1733 }
  },
  {
    { 14, 1, 4,  19,  -1,  -1,   56 },
    { 14, 2, 4,  19,  -1,  -1,  171 },
    { 14, 3, 8, 169,   4, 252,  777 },
    { 14, 4, 8, 135,  58, 189, 1121 },
    { 14, 5, 8, 135,  58, 189, 1508 },
    { 14, 6, 8, 135,  58, 188, 1880 }
  },
  {
    { 15, 1, 4,  19,  -1,  -1,   60 },
    { 15, 2, 8, 135,  -1,  -1,  353 },
    { 15, 3, 8, 113,  24, 209,  836 },
    { 15, 4, 8, 135,  58, 189, 1225 },
    { 15, 5, 8, 101,  28, 232, 1644 },
    { 15, 6, 8, 113, 120, 241, 2037 }
  },
  {
    { 16, 1, 8,  29,  -1,  -1,  128 },
    { 16, 2, 8, 135,  -1,  -1,  380 },
    { 16, 3, 8, 113,  22, 213,  901 },
    { 16, 4, 8, 113,  22, 212, 1324 },
    { 16, 5, 8, 101,  28, 232, 1765 },
    { 16, 6, 8, 101,  28, 232, 2195 }
  },
  {
    { 17, 1, 8,  29,  -1,  -1,  136 },
    { 17, 2, 8, 135,  -1,  -1,  407 },
    { 17, 3, 8, 113,  22, 213,  960 },
    { 17, 4, 8, 135,  58, 189, 1423 },
    { 17, 5, 8, 101,  27, 232, 1880 },
    { 17, 6, 8, 101,  27, 232, 2343 }
  },
  {
    { 18, 1, 8,  29,  -1,  -1,  144 },
    { 18, 2, 8, 135,  -1,  -1,  434 },
    { 18, 3, 8, 113,  24, 213, 1027 },
    { 18, 4, 8, 113,  22, 212, 1513 },
    { 18, 5, 8, 195,   8,  32, 2019 },
    { 18, 6, 8, 113, 205, 126, 2500 }
  },
  {
    { 19, 1, 8,  29,  -1,  -1,  152 },
    { 19, 2, 8, 135,  -1,  -1,  462 },
    { 19, 3, 8, 113,  22, 213, 1086 },
    { 19, 4, 8, 113,  23, 212, 1604 },
    { 19, 5, 8, 195,   7,  32, 2131 },
    { 19, 6, 8, 195,   3,  60, 2654 }
  },
  {
    { 20, 1, 8,  29,  -1,  -1,  160 },
    { 20, 2, 8, 135,  -1,  -1,  490 },
    { 20, 3, 8, 113,  22, 213, 1147 },
    { 20, 4, 8, 113,  22, 212, 1695 },
    { 20, 5, 8, 195,   4, 238, 2270 },
    { 20, 6, 8, 113,  21, 233, 2816 }
  },
  {
    { 21, 1, 8,  29,  -1,  -1,  168 },
    { 21, 2, 8, 135,  -1,  -1,  518 },
    { 21, 3, 8, 113,  21, 213, 1225 },
    { 21, 4, 8, 113,  21, 212, 1801 },
    { 21, 5, 8, 195,   3,  60, 2395 },
    { 21, 6, 8, 195,   3,  60, 2980 }
  },
  {
    { 22, 1, 8,  29,  -1,  -1,  176 },
    { 22, 2, 8, 135,  -1,  -1,  546 },
    { 22, 3, 8, 113,  20, 213, 1292 },
    { 22, 4, 8, 113,  21, 212, 1906 },
    { 22, 5, 8, 195,  35,  28, 2512 },
    { 22, 6, 8, 195,   3,  60, 3135 }
  },
  {
    { 23, 1, 8,  29,  -1,  -1,  184 },
    { 23, 2, 8, 135,  -1,  -1,  574 },
    { 23, 3, 8, 113,  19, 213, 1366 },
    { 23, 4, 8, 113,  19, 212, 2008 },
    { 23, 5, 8, 195,   3, 238, 2652 },
    { 23, 6, 8, 113, 205, 126, 3291 }
  },
  {
    { 24, 1, 8,  29,  -1,  -1,  192 },
    { 24, 2, 8, 135,  -1,  -1,  603 },
    { 24, 3, 8, 113,  18, 213, 1437 },
    { 24, 4, 8, 195, 125,  91, 2110 },
    { 24, 5, 8, 195,   3, 238, 2787 },
    { 24, 6, 8, 195,  42, 225, 3466 }
  }
};

static int g_divide(
  const int* log,
  const int* exp,
  const int w,
  const int a,
  const int b
) {
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  const int y = (1 << w) - 1;
  assert(a <= y);
  assert(b <= y);
  assert(b >= 1);
  if (a == 0) return 0;
  return exp[(log[a] + y - log[b]) % y];
}

static int g_multiply(
  const int* log,
  const int* exp,
  const int w,
  const int a,
  const int b
) {
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  const int y = (1 << w) - 1;
  assert(a <= y);
  assert(b <= y);
  if (a == 0 || b == 0) return 0;
  return exp[(log[a] + log[b]) % y];
}

static int bitmatrix_m0_optimized(
  const int w,
  const int k,
  const uint8_t* bitmatrix
) {
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  assert(k >= 1);
  assert(k <= MAX_K);
  assert(k < (1 << w));
  // We assume that bitmatrix is an encoding (not decoding) bitmatrix.
  // If row 0 is all ones then an erasure of shard < k + 1 can be optimized.
  for (int c = 0; c < k; c++) {
    for (int a = 0; a < w; a++) {
      if (a == 0) {
        if (bitmatrix[c * w + a] != 1) return 0;
      } else {
        if (bitmatrix[c * w + a] != 0) return 0;
      }
    }
  }
  return 1;
}

static void create_bitmatrix_decoding_swap(
  uint8_t* buffer,
  const int x,
  const int y
) {
  const uint8_t tmp = buffer[x];
  buffer[x] = buffer[y];
  buffer[y] = tmp;
}

static void create_bitmatrix_decoding_invert(
  uint8_t* source,
  uint8_t* target,
  const int rows
) {
  const int cols = rows;
  int k = 0;
  for (int r = 0; r < rows; r++) {
    for (int c = 0; c < cols; c++) {
      target[k++] = (r == c) ? 1 : 0;
    }
  }
  for (int c = 0; c < cols; c++) {
    if ((source[c * cols + c]) == 0) {
      int r = c + 1;
      while (r < rows && source[r * cols + c] == 0) r++;
      // Assert that matrix is invertible:
      assert(r != rows);
      for (int k = 0; k < cols; k++) {
        create_bitmatrix_decoding_swap(source, c * cols + k, r * cols + k);
        create_bitmatrix_decoding_swap(target, c * cols + k, r * cols + k);
      }
    }
    for (int r = c + 1; r != rows; r++) {
      if (source[r * cols + c] != 0) {
        for (int k = 0; k < cols; k++) {
          source[r * cols + k] ^= source[c * cols + k];
          target[r * cols + k] ^= target[c * cols + k];
        }
      }
    }
  }
  for (int r = rows - 1; r >= 0; r--) {
    for (int c = 0; c < r; c++) {
      if (source[c * cols + r]) {
        for (int k = 0; k < cols; k++) {
          source[c * cols + k] ^= source[r * cols + k]; 
          target[c * cols + k] ^= target[r * cols + k];
        }
      }
    }
  }
}

static void create_bitmatrix_decoding(
  const int w,
  const int k,
  const int m,
  const int* sourceIndex,
  const uint8_t* source,
  uint8_t* target
) {
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  assert(k >= 1);
  assert(k <= MAX_K);
  assert(m >= 1);
  assert(m <= MAX_M);
  assert(k + m <= (1 << w));
  const int kww = k * w * w;
  uint8_t matrix[MAX_K * MAX_K * MAX_W * MAX_W];
  for (int a = 0; a < k; a++) {
    if (sourceIndex[a] < k) {
      for (int b = 0; b < kww; b++) matrix[kww * a + b] = 0;
      int index = kww * a + sourceIndex[a] * w;
      for (int b = 0; b < w; b++) {
        matrix[index] = 1;
        index += (k * w + 1);
      }
    } else {
      for (int b = 0; b < kww; b++) {
        matrix[kww * a + b] = source[kww * (sourceIndex[a] - k) + b];
      }
    }
  }
  create_bitmatrix_decoding_invert(matrix, target, k * w);
}

static int create_bitmatrix_encoding(
  const int* log,
  const int* exp,
  const int w,
  const int k,
  const int m,
  const uint8_t* matrix,
  uint8_t* bitmatrix
) {
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  assert(k >= 1);
  assert(k <= MAX_K);
  assert(m >= 1);
  assert(m <= MAX_M);
  assert(k + m <= (1 << w));
  int count = 0;
  for (int r = 0; r < m; r++) {
    for (int c = 0; c < k; c++) {
      int x = matrix[(k * r) + c];
      for (int a = 0; a < w; a++) {
        for (int b = 0; b < w; b++) {
          int y = (x & (1 << b)) ? 1 : 0;
          bitmatrix[(r * w * k * w) + (w * c) + a + (k * w * b)] = y;
          count += y;
        }
        x = g_multiply(log, exp, w, x, 2);
      }
    }
  }
  assert(count > 0);
  return count;
}

static int create_matrix(
  const int* log,
  const int* exp,
  const int* bit,
  const int* min,
  const int w,
  const int k,
  const int m,
  const int x,
  const int y,
  uint8_t* matrix
) {
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  assert(k >= 1);
  assert(k <= MAX_K);
  assert(m >= 1);
  assert(m <= MAX_M);
  assert(k + m <= (1 << w));
  const int z = 1 << w;
  int count = bit[1] * k;
  if (m == 1) {
    // Use XOR for row 0.
    assert(x == -1);
    assert(y == -1);
    for (int c = 0; c < k; c++) matrix[c] = 1;
  } else if (m == 2) {
    // Use XOR for row 0.
    // Use integers with least number of bits for row 1.
    assert(x == -1);
    assert(y == -1);
    for (int c = 0; c < k; c++) matrix[c] = 1;
    for (int c = 0; c < k; c++) {
      matrix[k + c] = min[c + 1];
      if (c == 0) assert(matrix[k + c] == 1);
      assert(matrix[k + c] > 0);
      count += bit[matrix[k + c]];
    }
  } else {
    // Use XOR for row 0.
    // Use generic matrix thereafter.
    assert(x + k <= z);
    assert(y + m <= z);
    assert(x != y);
    if (x < y) {
      assert(x + k <= y);
    } else {
      assert(y + m <= x);
    }
    for (int r = 0; r < m; r++) {
      for (int c = 0; c < k; c++) {
        assert(y + r < z);
        assert(x + c < z);
        matrix[r * k + c] = g_divide(log, exp, w, 1, (y + r) ^ (x + c));
      }
    }
    // Divide rows by row 0:
    for (int r = 1; r < m; r++) {
      for (int c = 0; c < k; c++) {
        matrix[r * k + c] = g_divide(log, exp, w, matrix[r * k + c], matrix[c]);
      }
    }
    // Divide row 0 by itself to set row 0 to 1:
    for (int c = 0; c < k; c++) {
      matrix[c] = g_divide(log, exp, w, matrix[c], matrix[c]);
      assert(matrix[c] == 1);
    }
    // Divide columns by the column which minimizes the resulting ones (if any):
    for (int r = 1; r < m; r++) {
      const int rk = r * k;
      int result = 0;
      int column = -1;
      for (int c = 0; c < k; c++) result += bit[matrix[rk + c]];
      for (int c = 0; c < k; c++) {
        int bits = 0;
        for (int d = 0; d < k; d++) {
          bits += bit[g_divide(log, exp, w, matrix[rk + d], matrix[rk + c])];
        }
        if (bits < result) {
          result = bits;
          column = matrix[rk + c];
        }
      }
      if (column >= 0) {
        for (int c = 0; c < k; c++) {
          matrix[rk + c] = g_divide(log, exp, w, matrix[rk + c], column);
        }
      }
      count += result;
    }
  }
  for (int c = 0; c < k; c++) assert(matrix[c] == 1);
  assert(count > 0);
  return count;
}

static int create_tables_bits(
  const int* log,
  const int* exp,
  const int w,
  int n
) {
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  int count = 0;
  for (int r = 0; r < w; r++) {
    for (int c = 0; c < w; c++) {
      count += (n & (1 << c)) ? 1 : 0;
    }
    n = g_multiply(log, exp, w, n, 2);
  }
  return count;
}

static void create_tables(
  const int w,
  const int p,
  int* log,
  int* exp,
  int* bit,
  int* min
) {
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  const int y = (1 << w) - 1;
  const int z = (1 << w);
  // Generate log and exp tables:
  for (int a = 0; a < z; a++) {
    log[a] = y;
    exp[a] = 0;
  }
  int b = 1;
  for (int a = 0; a < y; a++) {
    assert(b < z);
    assert(log[b] == y);
    assert(exp[a] == 0);
    log[b] = a;
    exp[a] = b;
    b = b << 1;
    if (b & z) b = (b ^ p) & y;
  }
  // The logarithm of zero must not be defined:
  assert(log[0] == y);
  // The last byte of the exponents table must not be defined:
  assert(exp[y] == 0);
  // Generate bit table (number of bits per matrix number):
  for (int n = 0; n < z; n++) {
    bit[n] = create_tables_bits(log, exp, w, n);
    if (n == 0) {
      assert(bit[n] == 0);
    } else {
      assert(bit[n] > 0);
    }
  }
  // Generate min table (matrix numbers sorted by least number of bits):
  assert(bit[0] == 0);
  min[0] = 0;
  for (int a = 1; a < z; a++) {
    assert(a > 0);
    int c = min[a - 1];
    int d = -1;
    for (int b = 1; b < z; b++) {
      assert(b > 0);
      assert(bit[b] > 0);
      if (bit[b] < bit[c]) continue;
      if (bit[b] == bit[c] && b <= c) continue;
      if (d == -1 || bit[b] < bit[d]) d = b;
    }
    assert(d > 0);
    assert(d < z);
    min[a] = d;
  }
  assert(min[y] > 0);
}

static uintptr_t unaligned64(const uint8_t* pointer) {
  return ((uintptr_t) pointer) & ((uintptr_t) 7);
}

static uint32_t dot_chunk_size(
  const int w,
  const int k,
  const uint32_t shardSize
) {
  // Every dot loop pair (b * k, c * w) uses ((1 + k * w) * chunkSize) of cache.
  // Avoiding cache misses yields a 40-100% improvement when shardSize is large.
  // We therefore reduce the chunkSize if necessary to stay within the cache.
  // The shardSize should ideally be a power of 2 to do this optimally.
  // N.B. The chunkSize changes the encoded parity result.
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  assert(k >= 1);
  assert(k <= MAX_K);
  assert(k < (1 << w));
  assert(shardSize % w == 0);
  uint32_t chunkSize = shardSize / w;
  while (
    chunkSize > 64 &&
    chunkSize % 2 == 0 &&
    (1 + k * w) * chunkSize > 1048576
  ) {
    chunkSize /= 2;
  }
  assert(chunkSize > 0);
  assert(shardSize % (w * chunkSize) == 0);
  return chunkSize;
}

static void dot_cpy(uint8_t* source, uint8_t* target, uint32_t length) {
  assert(length > 0);
  assert(source != target);
  memcpy(target, source, length);
}

static void dot_xor(uint8_t* source, uint8_t* target, uint32_t length) {
  assert(source != target);
  assert(length > 0);
  uint8_t* sourceEnd = source + length;
  uint8_t* targetEnd = target + length;
  // XOR 8-bit words if source and target alignment cannot be corrected:
  if (unaligned64(source) != unaligned64(target)) {
    while (length > 0) {
      *target++ ^= *source++;
      length--;
    }
    assert(source == sourceEnd);
    assert(target == targetEnd);
    assert(length == 0);
    return;
  }
  // XOR 8-bit words to correct source and target alignment:
  while (unaligned64(source) && length > 0) {
    *target++ ^= *source++;
    length--;
  }
  if (length == 0) {
    assert(source == sourceEnd);
    assert(target == targetEnd);
    return;
  }
  assert(unaligned64(source) == 0);
  assert(unaligned64(target) == 0);
  // XOR as many 64-bit words as possible:
  uint32_t words = length / 8;
  if (words > 0) {
    uint32_t width = words * 8;
    assert(width <= length);
    uint64_t* source64 = (uint64_t*) source;
    uint64_t* target64 = (uint64_t*) target;
    while (words > 0) {
      *target64++ ^= *source64++;
      words--;
    }
    assert(words == 0);
    source += width;
    target += width;
    length -= width;
  }
  // XOR 8-bit words remainder:
  assert(length < 8);
  while (length > 0) {
    *target++ ^= *source++;
    length--;
  }
  assert(source == sourceEnd);
  assert(target == targetEnd);
  assert(length == 0);
}

static void dot(
  const int w,
  const int k,
  uint8_t** shards,
  const uint32_t shardSize,
  const uint8_t* row,
  const int* sourceIndex,
  const int targetIndex
) {
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  assert(k >= 1);
  assert(k <= MAX_K);
  assert(k < (1 << w));
  assert(shardSize % w == 0);
  uint32_t chunkSize = dot_chunk_size(w, k, shardSize);
  assert(w * chunkSize <= shardSize);
  assert(shardSize % (w * chunkSize) == 0);
  uint32_t shardOffset = 0;
  while (shardOffset < shardSize) {
    int column = 0;
    for (int a = 0; a < w; a++) {
      int copied = 0;
      uint8_t* target = shards[targetIndex] + shardOffset + a * chunkSize;
      for (int b = 0; b < k; b++) {
        uint8_t* source = shards[sourceIndex[b]];
        for (int c = 0; c < w; c++) {
          if (row[column]) {
            if (!copied) {
              dot_cpy(source + shardOffset + c * chunkSize, target, chunkSize);
              copied = 1;
            } else {
              dot_xor(source + shardOffset + c * chunkSize, target, chunkSize);
            }
          }
          column++;
        }
      }
    }
    shardOffset += w * chunkSize;
  }
  assert(shardOffset == shardSize);
}

static int flags_count(uint32_t flags) {
  int count = 0;
  while (flags > 0) {
    if (flags & 1) count++; // Check lower bit.
    flags >>= 1; // Shift lower bit.
  }
  return count;
}

static int flags_first(const uint32_t flags) {
  int i = 0;
  while ((flags & (1 << i)) == 0) i++;
  assert((flags & (1 << i)) != 0);
  return i;
}

static void reed_solomon_encode(
  const int w,
  const int k,
  const int m,
  const uint8_t* bitmatrixEncoding,
  const uint32_t sources,
  const uint32_t targets,
  uint8_t** shards,
  const uint32_t shardSize
) {
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  assert(k >= 1);
  assert(k <= MAX_K);
  assert(m >= 1);
  assert(m <= MAX_M);
  assert(k + m <= (1 << w));
  if (k == 1) {
    // Optimization for pure replication, encoding only targets:
    uint8_t* source = shards[flags_first(sources)];
    for (int i = 0; i < k + m; i++) {
      if (targets & (1 << i)) dot_cpy(source, shards[i], shardSize);
    }
    return;
  }
  if (
    flags_count(targets) == 1 &&
    flags_count(sources & ((1 << (k + 1)) - 1)) == k &&
    flags_count(targets & ((1 << (k + 1)) - 1)) == 1
  ) {
    // Optimization for 1 erasure (i < k + 1), encoding only targets:
    uint8_t* target = shards[flags_first(targets)];
    int copied = 0;
    for (int i = 0; i < k + 1; i++) {
      if (sources & (1 << i)) {
        if (!copied) {
          dot_cpy(shards[i], target, shardSize);
          copied = 1;
        } else {
          dot_xor(shards[i], target, shardSize);
        }
      }
    }
    return;
  }
  const int kww = k * w * w;
  int max = k;
  int kerasures = 0;
  for (int i = 0; i < k; i++) {
    if (!(sources & (1 << i))) {
      max = i;
      kerasures++;
    }
  }
  if (!(sources & (1 << k))) max = k;
  if (kerasures > 1 || (kerasures == 1 && !(sources & (1 << k)))) {
    int s[MAX_K];
    int si = 0;
    int sj = 0;
    while (sj < k) {
      if (sources & (1 << si)) s[sj++] = si;
      si++;
    }
    uint8_t bitmatrixDecoding[MAX_K * MAX_K * MAX_W * MAX_W];
    create_bitmatrix_decoding(
      w,
      k,
      m,
      s,
      bitmatrixEncoding,
      bitmatrixDecoding
    );
    for (int i = 0; kerasures > 0 && i < max; i++) {
      if (!(sources & (1 << i))) {
        dot(w, k, shards, shardSize, bitmatrixDecoding + kww * i, s, i);
        kerasures--;
      }
    }
  }
  if (kerasures > 0) {
    int s[MAX_K];
    for (int si = 0; si < k; si++) s[si] = (si < max) ? si : si + 1;
    dot(w, k, shards, shardSize, bitmatrixEncoding, s, max);
  }
  for (int i = 0; i < m; i++) {
    if (!(sources & (1 << (k + i)))) {
      int s[MAX_K];
      for (int si = 0; si < k; si++) s[si] = si;
      dot(w, k, shards, shardSize, bitmatrixEncoding + kww * i, s, k + i);
    }
  }
}

static int arg_buf(
  napi_env env,
  napi_value value,
  uint8_t** buffer,
  uint32_t* buffer_length
) {
  assert(value != NULL);
  assert(*buffer == NULL);
  assert(*buffer_length == 0);
  bool is_buffer = 0;
  OK(napi_is_buffer(env, value, &is_buffer));
  if (!is_buffer) return 0;
  size_t length = 0;
  OK(napi_get_buffer_info(env, value, (void**) buffer, &length));
  assert(*buffer != NULL);
  assert(length <= UINT32_MAX);
  *buffer_length = length;
  return 1;
}

static int arg_int(napi_env env, napi_value value, uint32_t* integer) {
  assert(*integer == 0);
  double temp = 0;
  if (
    // We get the value as a double so we can check for NaN, Infinity and float:
    // https://github.com/nodejs/node/issues/26323
    napi_get_value_double(env, value, &temp) != napi_ok ||
    temp < 0 ||
    isnan(temp) ||
    // Infinity, also prevent UB for double->int cast below:
    // https://groups.google.com/forum/#!topic/comp.lang.c/rhPzd4bgKJk
    temp > UINT32_MAX ||
    // Float:
    (double) ((uint32_t) temp) != temp
  ) {
    return 0;
  }
  *integer = (uint32_t) temp;
  return 1;
}

void set_int(
  napi_env env,
  napi_value object,
  const char* name,
  const int64_t integer
) {
  assert(integer >= 0);
  napi_value value;
  OK(napi_create_int64(env, integer, &value));
  OK(napi_set_named_property(env, object, name, value));
}

void set_method(
  napi_env env,
  napi_value object,
  const char* name,
  void* method
) {
  napi_value value;
  OK(napi_create_function(env, NULL, 0, method, NULL, &value));
  OK(napi_set_named_property(env, object, name, value));
}

struct task_data {
  uint8_t* context;
  uint32_t contextSize;
  uint32_t sources;
  uint32_t targets;
  uint8_t* buffer;
  uint32_t bufferSize;
  uint8_t* parity;
  uint32_t paritySize;
  uint32_t shardSize;
  napi_ref ref_context;
  napi_ref ref_buffer;
  napi_ref ref_parity;
  napi_ref ref_callback;
  napi_async_work async_work;
};

void task_execute(napi_env env, void* data) {
  struct task_data* task = data;
  assert(task->context != NULL);
  assert(task->contextSize > 3);
  assert(task->buffer != NULL);
  assert(task->parity != NULL);
  assert(task->shardSize > 0);
  const int w = task->context[0];
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  const int k = task->context[1];
  assert(k >= 1);
  assert(k <= MAX_K);
  const int m = task->context[2];
  assert(m >= 1);
  assert(m <= MAX_M);
  assert(k + m <= (1 << w));
  assert(task->contextSize == (uint32_t) (3 + k * w * m * w));
  const uint8_t* bitmatrix = task->context + 3;
  uint8_t* shards[MAX_K + MAX_M];
  assert(task->shardSize * k <= task->bufferSize);
  for (int index = 0; index < k; index++) {
    shards[index] = task->buffer + task->shardSize * index;
  }
  assert(task->shardSize * m <= task->paritySize);
  for (int index = 0; index < m; index++) {
    shards[index + k] = task->parity + task->shardSize * index;
  }
  reed_solomon_encode(
    w,
    k,
    m,
    bitmatrix,
    task->sources,
    task->targets,
    shards,
    task->shardSize
  );
}

void task_complete(napi_env env, napi_status status, void* data) {
  struct task_data* task = data;
  assert(status == napi_ok);
  napi_value scope;
  OK(napi_get_global(env, &scope));
  napi_value callback;
  OK(napi_get_reference_value(env, task->ref_callback, &callback));
  // Do not assert the return status of napi_call_function():
  // If the callback throws then the return status will not be napi_ok.
  napi_call_function(env, scope, callback, 0, NULL, NULL);
  assert(task->ref_context != NULL);
  assert(task->ref_buffer != NULL);
  assert(task->ref_parity != NULL);
  assert(task->ref_callback != NULL);
  assert(task->async_work != NULL);
  OK(napi_delete_reference(env, task->ref_context));
  OK(napi_delete_reference(env, task->ref_buffer));
  OK(napi_delete_reference(env, task->ref_parity));
  OK(napi_delete_reference(env, task->ref_callback));
  OK(napi_delete_async_work(env, task->async_work));
  free(task);
  task = NULL;
}

static napi_value create(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  OK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  uint32_t ku = 0;
  uint32_t mu = 0;
  if (argc != 2 || !arg_int(env, argv[0], &ku) || !arg_int(env, argv[1], &mu)) {
    THROW(env, "bad arguments, expected: (int k, int m)");
  }
  if (ku < 1) THROW(env, "k < 1");
  if (ku > MAX_K) THROW(env, "k > MAX_K");
  if (mu < 1) THROW(env, "m < 1");
  if (mu > MAX_M) THROW(env, "m > MAX_M");
  assert(MAX_K <= INT_MAX);
  assert(MAX_M <= INT_MAX);
  int k = (int) ku;
  int m = (int) mu;
  assert(sizeof(PARAMETERS) == MAX_K * MAX_M * 7 * sizeof(int));
  assert(PARAMETERS[k - 1][m - 1][0] == k);
  assert(PARAMETERS[k - 1][m - 1][1] == m);
  int w = PARAMETERS[k - 1][m - 1][2];
  assert(w <= MAX_W);
  assert(w == 2 || w == 4 || w == 8);
  assert(k + m <= (1 << w));
  int p = PARAMETERS[k - 1][m - 1][3];
  int x = PARAMETERS[k - 1][m - 1][4];
  int y = PARAMETERS[k - 1][m - 1][5];
  if (m <= 2) {
    assert(x == -1);
    assert(y == -1);
  } else {
    assert(y != x);
  }
  int b = PARAMETERS[k - 1][m - 1][6];
  assert(b >= 1);
  assert(b <= k * w * m * w);
  int log[1 << MAX_W];
  int exp[1 << MAX_W];
  int bit[1 << MAX_W];
  int min[1 << MAX_W];
  create_tables(w, p, log, exp, bit, min);
  uint8_t matrix[MAX_K * MAX_M];
  assert(create_matrix(log, exp, bit, min, w, k, m, x, y, matrix) == b);
  size_t contextSize = 3 + k * w * m * w;
  uint8_t* context = NULL;
  napi_value buffer = NULL;
  OK(napi_create_buffer(env, contextSize, (void**) &context, &buffer));
  assert(context != NULL);
  assert(buffer != NULL);
  context[0] = w;
  context[1] = k;
  context[2] = m;
  uint8_t* bitmatrix = context + 3;
  assert(create_bitmatrix_encoding(log, exp, w, k, m, matrix, bitmatrix) == b);
  assert(bitmatrix_m0_optimized(w, k, bitmatrix) == 1);
  return buffer;
}

static napi_value encode(napi_env env, napi_callback_info info) {
  size_t argc = 10;
  napi_value argv[10];
  OK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  uint8_t* context = NULL;
  uint32_t contextLength = 0;
  uint32_t sources = 0;
  uint32_t targets = 0;
  uint8_t* buffer = NULL;
  uint32_t bufferLength = 0;
  uint32_t bufferOffset = 0;
  uint32_t bufferSize = 0;
  uint8_t* parity = NULL;
  uint32_t parityLength = 0;
  uint32_t parityOffset = 0;
  uint32_t paritySize = 0;
  napi_valuetype callback_type;
  OK(napi_typeof(env, argv[9], &callback_type));
  if (
    argc != 10 ||
    !arg_buf(env, argv[0], &context, &contextLength) ||
    !arg_int(env, argv[1], &sources) ||
    !arg_int(env, argv[2], &targets) ||
    !arg_buf(env, argv[3], &buffer, &bufferLength) ||
    !arg_int(env, argv[4], &bufferOffset) ||
    !arg_int(env, argv[5], &bufferSize) ||
    !arg_buf(env, argv[6], &parity, &parityLength) ||
    !arg_int(env, argv[7], &parityOffset) ||
    !arg_int(env, argv[8], &paritySize) ||
    callback_type != napi_function
  ) {
    THROW(
      env,
      "bad arguments, expected: (Buffer context, int sources, int targets, "
      "Buffer buffer, int bufferOffset, int bufferSize, "
      "Buffer parity, int parityOffset, int paritySize, function end)"
    );
  }
  assert(context != NULL);
  assert(buffer != NULL);
  assert(parity != NULL);
  if (contextLength < 3) THROW(env, "context.length < 3");
  int w = (int) context[0];
  int k = (int) context[1];
  int m = (int) context[2];
  if (w != 2 && w != 4 && w != 8) THROW(env, "w != 2, 4, 8");
  if (k < 1) THROW(env, "k < 1");
  if (k > MAX_K) THROW(env, "k > MAX_K");
  if (m < 1) THROW(env, "m < 1");
  if (m > MAX_M) THROW(env, "m > MAX_M");
  if (k + m > (1 << w)) THROW(env, "k + m > (1 << w)");
  if (contextLength != (uint32_t) (3 + k * w * m * w)) {
    THROW(env, "context.length is bad");
  }
  if (bitmatrix_m0_optimized(w, k, context + 3) != 1) {
    THROW(env, "bitmatrix not optimized");
  }
  assert(k + m < 31);
  if (sources >= (uint32_t) 1 << (k + m)) THROW(env, "sources > k + m");
  const int sourcesCount = flags_count(sources);
  if (sourcesCount == 0) THROW(env, "sources == 0");
  if (sourcesCount < k) THROW(env, "sources < k");
  assert(k + m < 31);
  if (targets >= (uint32_t) 1 << (k + m)) THROW(env, "targets > k + m");
  const int targetsCount = flags_count(targets);
  if (targetsCount == 0) THROW(env, "targets == 0");
  if (targetsCount > m) THROW(env, "targets > m");
  if ((sources & targets) != 0) THROW(env, "(sources & targets) != 0");
  if (bufferSize == 0) THROW(env, "bufferSize == 0");
  if ((uint64_t) bufferOffset + bufferSize > bufferLength) {
    THROW(env, "bufferOffset + bufferSize > buffer.length");
  }
  if (bufferSize % k != 0) THROW(env, "bufferSize % k != 0");
  const uint32_t shardSize = bufferSize / k;
  assert(shardSize != 0);
  if (shardSize % w != 0) THROW(env, "shardSize % w != 0");
  if (shardSize % 8 != 0) THROW(env, "shardSize % 8 != 0");
  if (paritySize == 0) THROW(env, "paritySize == 0");
  if (paritySize % m != 0) THROW(env, "paritySize % m != 0");
  if (paritySize / m != shardSize) {
    THROW(env, "paritySize / m != bufferSize / k");
  }
  if ((uint64_t) parityOffset + paritySize > parityLength) {
    THROW(env, "parityOffset + paritySize > parity.length");
  }
  struct task_data* task = calloc(1, sizeof(struct task_data));
  if (!task) THROW(env, "insufficient memory");
  task->context = context;
  task->contextSize = contextLength;
  task->sources = sources;
  task->targets = targets;
  task->buffer = buffer + bufferOffset;
  task->bufferSize = bufferSize;
  task->parity = parity + parityOffset;
  task->paritySize = paritySize;
  task->shardSize = shardSize;
  OK(napi_create_reference(env, argv[0], 1, &task->ref_context));
  OK(napi_create_reference(env, argv[3], 1, &task->ref_buffer));
  OK(napi_create_reference(env, argv[6], 1, &task->ref_parity));
  OK(napi_create_reference(env, argv[9], 1, &task->ref_callback));
  napi_value name;
  OK(napi_create_string_utf8(env, RESOURCE_NAME, NAPI_AUTO_LENGTH, &name));
  OK(napi_create_async_work(
    env,
    NULL,
    name,
    task_execute,
    task_complete,
    task,
    &task->async_work
  ));
  OK(napi_queue_async_work(env, task->async_work));
  return NULL;
}

static napi_value search(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  OK(napi_get_cb_info(env, info, &argc, NULL, NULL, NULL));
  if (argc != 0) THROW(env, "expected no arguments");
  const int kl = 24;
  const int ks[] = {
     1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24
  };
  const int ml = 6;
  const int ms[] = { 1, 2, 3, 4, 5, 6 };
  const int wl = 3;
  const int ws[] = { 2, 4, 8 };
  const int pl2 = 1;
  const int ps2[] = { 7 };
  const int pl4 = 1;
  const int ps4[] = { 19 };
  const int pl8 = 16;
  const int ps8[] = {
     29,  43,  45,  77,  95,  99, 101, 105,
    113, 135, 141, 169, 195, 207, 231, 245
  };
  const int pl[] = { pl2, pl4, pl8 };
  const int* ps[] = { ps2, ps4, ps8 };
  int log[256];
  int exp[256];
  int bit[256];
  int min[256];
  uint8_t matrix[65536];
  printf("static const int PARAMETERS[%i][%i][7] = {\n", kl, ml);
  for (int ki = 0; ki < kl; ki++) {
    int k = ks[ki];
    assert(k >= 1);
    assert(k <= 24);
    printf("  {\n");
    for (int mi = 0; mi < ml; mi++) {
      int m = ms[mi];
      assert(m >= 1);
      assert(m <= 6);
      int minB = -1;
      int minW = -1;
      int minP = -1;
      int minX = -1;
      int minY = -1;
      for (int wi = 0; wi < wl; wi++) {
        int w = ws[wi];
        assert(w <= MAX_W);
        assert(w == 2 || w == 4 || w == 8);
        if (k + m > (1 << w)) continue;
        for (int pi = 0; pi < pl[wi]; pi++) {
          int p = ps[wi][pi];
          assert(p >= 1);
          create_tables(w, p, log, exp, bit, min);
          if (m <= 2) {
            int x = -1;
            int y = -1;
            int b = create_matrix(log, exp, bit, min, w, k, m, x, y, matrix);
            if (b < minB || minB == -1) {
              minB = b;
              minW = w;
              minP = p;
              minX = -1;
              minY = -1;
            }
            continue;
          }
          int z = (1 << w);
          for (int x = 0; x + k <= z; x++) {
            for (int y = 0; y + m <= z; y++) {
              if (x == y) continue;
              if (x < y && (x + k) > y) continue;
              if (y < x && (y + m) > x) continue;
              int b = create_matrix(log, exp, bit, min, w, k, m, x, y, matrix);
              if (b < minB || minB == -1) {
                minB = b;
                minW = w;
                minP = p;
                minX = x;
                minY = y;
              }
            }
          }
        }
      }
      printf(
        "    { %2i, %1i, %1i, %3i, %3i, %3i, %4i }",
        k, m, minW, minP, minX, minY, minB
      );
      printf(mi < ml - 1 ? ",\n" : "\n");
    }
    printf(ki < kl - 1 ? "  },\n" : "  }\n");
  }
  printf("};\n");
  return NULL;
}

static napi_value XOR(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value argv[5];
  OK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  uint8_t* source = NULL;
  uint32_t sourceLength = 0;
  uint32_t sourceOffset = 0;
  uint8_t* target = NULL;
  uint32_t targetLength = 0;
  uint32_t targetOffset = 0;
  uint32_t size = 0;
  if (
    argc != 5 ||
    !arg_buf(env, argv[0], &source, &sourceLength) ||
    !arg_int(env, argv[1], &sourceOffset) ||
    !arg_buf(env, argv[2], &target, &targetLength) ||
    !arg_int(env, argv[3], &targetOffset) ||
    !arg_int(env, argv[4], &size)
  ) {
    THROW(
      env,
      "bad arguments, expected: ("
      "Buffer source, int sourceOffset, "
      "Buffer target, int targetOffset, int size)"
    );
  }
  assert(source != NULL);
  assert(target != NULL);
  if ((uint64_t) sourceOffset + size > sourceLength) {
    THROW(env, "sourceOffset + size > source.length");
  }
  if ((uint64_t) targetOffset + size > targetLength) {
    THROW(env, "targetOffset + size > target.length");
  }
  if (size > 0) dot_xor(source + sourceOffset, target + targetOffset, size);
  return NULL;
}

static napi_value Init(napi_env env, napi_value exports) {
  // We require assert() for safety (our asserts are not side-effect free):
  #ifdef NDEBUG
    fprintf(stderr, "NDEBUG compile flag not supported\n");
    abort();
  #endif
  // We require ints to be at least 31 bits to prevent overflow issues:
  assert(INT_MAX >= 2147483647);
  // Keep `sources` and `targets` flags from exceeding 31 bits:
  // This side-steps issues with JavaScript signed/unsigned bitwise operations.
  assert(MAX_K + MAX_M < 31);
  assert(sizeof(uint64_t) == 8); // Assumed by unaligned64().
  assert(sizeof(PARAMETERS) == MAX_K * MAX_M * 7 * sizeof(int));
  set_int(env, exports, "MAX_K", MAX_K);
  set_int(env, exports, "MAX_M", MAX_M);
  set_method(env, exports, "create", create); // Create an encoding context.
  set_method(env, exports, "encode", encode); // Encode buffer or parity shards.
  set_method(env, exports, "search", search); // Search for optimal parameters.
  set_method(env, exports, "XOR", XOR);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

// S.D.G.

'use strict';

// Copyright (c) 2016 Joran Dirk Greef. All rights reserved.
// Copyright (c) 2015 Backblaze, Inc. All rights reserved.
// The MIT License (MIT)

// Special thanks to Irving Reed, Gustave Solomon and Backblaze.

// "What did you go out into the wilderness to see? A reed swayed by the wind?
// If not, what did you go out to see? A man dressed in fine clothes? No, those
// who wear expensive clothes and indulge in luxury are in palaces. But what
// did you go out to see?" - Luke 7

// "See how the flowers of the field grow. They do not labor or spin. Yet I
// tell you that not even Solomon in all his splendor was dressed like one of
// these." - Matthew 6

var ReedSolomon = function(dataShards, parityShards, binding) {
  var self = this;
  self.binding = binding || ReedSolomon.bindingNative || ReedSolomon.bindingJS;
  self.dataShards = dataShards;
  self.parityShards = parityShards;
  self.totalShards = self.dataShards + self.parityShards;
  if (self.totalShards > 256) {
    // The Vandermonde matrix is guaranteed for 256 rows.
    throw new Error('Data and parity shards must be at most 256 shards.');
  }
  self.matrix = ReedSolomon.matrix(self.dataShards, self.totalShards);
  self.parityRows = new Array(self.parityShards);
  for (var index = 0; index < self.parityShards; index++) {
    self.parityRows[index] = self.matrix.getRow(self.dataShards + index);
  }
};

// Checks the consistency of arguments passed to public methods.
ReedSolomon.prototype.check = function(shards, offset, size) {
  var self = this;
  // The number of buffers should be equal to the number of
  // data shards plus the number of parity shards.
  if (shards.length != self.totalShards) {
    throw new Error('Wrong number of shards: ' + shards.length);
  }
  // All of the shards should be buffers.
  // All of the shards should be the same length.
  var shardLength = shards[0].length;
  for (var index = 0; index < shards.length; index++) {
    var shard = shards[index];
    if (!Buffer.isBuffer(shard)) throw new Error('Shards must all be buffers.');
    if (shard.length != shardLength) {
      throw new Error('Shards are different sizes.');
    }
  }
  if (!ReedSolomon.integer(offset)) {
    throw new Error('Argument offset must be a positive integer.');
  }
  if (!ReedSolomon.integer(size)) {
    throw new Error('Argument size must be a positive integer.');
  }
  if (shardLength < offset + size) {
    throw new Error('Overflow with offset=' + offset + ', size=' + size + '.');
  }
};

// Multiplies a subset of rows from a coding matrix by a full set of
// input shards to produce some output shards, and checks that the
// the data in those shards matches what is expected.
ReedSolomon.prototype.checkSomeShards = function(
  matrixRows, sources, sourcesLength, targets, targetsLength, offset, size, temp
) {
  var self = this;
  var table = ReedSolomon.Galois.MULTIPLY_TABLE;
  for (var targetsIndex = 0; targetsIndex < targetsLength; targetsIndex++) {
    var target = targets[targetsIndex];
    var matrixRow = matrixRows[targetsIndex];
    for (var sourcesIndex = 0; sourcesIndex < sourcesLength; sourcesIndex++) {
      var source = sources[sourcesIndex];
      var multTableRow = table[matrixRow[sourcesIndex]];
      if (sourcesIndex === 0) {
        for (var index = offset; index < offset + size; index++) {
          temp[index] = multTableRow[source[index]];
        }
      } else {
        for (var index = offset; index < offset + size; index++) {
          temp[index] ^= multTableRow[source[index]];
        }
      }
    }
    for (var index = offset; index < offset + size; index++) {
      if (temp[index] != target[index]) return false;
    }
  }
  return true;
};

// Multiplies a subset of rows from a coding matrix by a full set of
// input shards to produce some output shards.
ReedSolomon.prototype.codeSomeShards = function(
  matrixRows, sources, sourcesLength, targets, targetsLength, offset, size
) {
  var self = this;
  var table = ReedSolomon.Galois.MULTIPLY_TABLE;
  for (var targetsIndex = 0; targetsIndex < targetsLength; targetsIndex++) {
    var target = targets[targetsIndex];
    var matrixRow = matrixRows[targetsIndex];
    self.binding.mset(
      table[matrixRow[0]],
      sources[0],
      target,
      offset,
      offset + size
    );
    for (var sourcesIndex = 1; sourcesIndex < sourcesLength; sourcesIndex++) {
      self.binding.mxor(
        table[matrixRow[sourcesIndex]],
        sources[sourcesIndex],
        target,
        offset,
        offset + size
      );
    }
  }
};

ReedSolomon.prototype.copy = function(src, srcPos, dst, dstPos, size) {
  var self = this;
  while (size--) dst[dstPos++] = src[srcPos++];
};

// Given a list of shards, some of which contain data, fills in the shards which
// do not contain data. Returns quickly if all the shards are present.
ReedSolomon.prototype.decode = function(shards, offset, size, present) {
  var self = this;
  self.check(shards, offset, size);
  // Are the shards all present? If so, there is nothing to be done further.
  if (!present || present.constructor !== Array) {
    throw new Error('Present argument should be an array.');
  }
  if (present.length !== self.totalShards) {
    throw new Error('Present array should have the same length as shards.');
  }
  var numberPresent = 0;
  for (var index = 0; index < self.totalShards; index++) {
    if (typeof present[index] !== 'boolean') {
      throw new Error('Present array elements should be booleans.');
    }
    if (present[index]) numberPresent += 1;
  }
  if (numberPresent == self.totalShards) return;
  if (numberPresent < self.dataShards) {
    // There is not enough redundant data to recover the missing data.
    throw new Error('Not enough shards present to recover data.');
  }
  // Pull out the rows of the matrix that correspond to the shards that we have
  // and build a square matrix.
  var subMatrix = new ReedSolomon.Matrix(
    self.dataShards,
    self.dataShards
  );
  // Pull out an array holding just the shards that correspond to the rows of
  // the submatrix. These shards will be the input to the decoding process that
  // recreates the missing data shards.
  var subShards = new Array(self.dataShards);
  var subMatrixRow = 0;
  var matrixRow = 0;
  while (matrixRow < self.totalShards && subMatrixRow < self.dataShards) {
    if (present[matrixRow]) {
      for (var column = 0; column < self.dataShards; column++) {
        subMatrix.set(subMatrixRow, column, self.matrix.get(matrixRow, column));
      }
      subShards[subMatrixRow] = shards[matrixRow];
      subMatrixRow += 1;
    }
    matrixRow++;
  }
  // Invert the matrix, so that we can go from the encoded shards back to the
  // original data. Then pull out the row that generates the shard that we want
  // to decode. Note that since this matrix maps back to the orginal data, it
  // can be used to create a data shard, but not a parity shard.
  var dataDecodeMatrix = subMatrix.invert();
  // Recreate any data shards that were missing. The inputs to the coding are
  // the shards we actually have, and the outputs are the missing data shards.
  // The computation is done using the special decode matrix we just built.
  var outputs = new Array(self.parityShards);
  var matrixRows = new Array(self.parityShards);
  var outputCount = 0;
  var shardsIndex = 0;
  var shardsLength = self.dataShards;
  while (shardsIndex < self.dataShards) {
    if (!present[shardsIndex]) {
      outputs[outputCount] = shards[shardsIndex];
      matrixRows[outputCount] = dataDecodeMatrix.getRow(shardsIndex);
      outputCount += 1;
    }
    shardsIndex++;
  }
  self.codeSomeShards(
    matrixRows,
    subShards,
    self.dataShards,
    outputs,
    outputCount,
    offset,
    size
  );
  // Now that we have all of the data shards intact, we can compute any of the
  // parity shards that are missing. The inputs to the coding are all of the
  // data shards, including any that we have just calculated. The outputs are
  // all the parity shards which were missing.
  outputCount = 0;
  var shardsIndex = self.dataShards;
  var shardsLength = self.totalShards;
  while (shardsIndex < self.totalShards) {
    if (!present[shardsIndex]) {
      outputs[outputCount] = shards[shardsIndex];
      matrixRows[outputCount] = self.parityRows[shardsIndex - self.dataShards];
      outputCount += 1;
    }
    shardsIndex++;
  }
  self.codeSomeShards(
    matrixRows,
    shards,
    self.dataShards,
    outputs,
    outputCount,
    offset,
    size
  );
};

// Encodes the parity shards for a set of data shards.
// All shards (including parity shards) must be initialized as buffers.
// All shards must be the same size.
// offset: The index of the first byte in each shard to encode.
// size: The number of bytes to encode in each shard.
ReedSolomon.prototype.encode = function(shards, offset, size) {
  var self = this;
  self.check(shards, offset, size);
  var outputs = new Array(self.parityShards);
  self.copy(shards, self.dataShards, outputs, 0, self.parityShards);
  self.codeSomeShards(
    self.parityRows,
    shards,
    self.dataShards,
    outputs,
    self.parityShards,
    offset,
    size
  );
};

// Returns true if the parity shards contain the right data.
ReedSolomon.prototype.isParityCorrect = function(shards, offset, size, temp) {
  var self = this;
  self.check(shards, offset, size);
  if (!temp) {
    throw new Error('Temp buffer should be provided.');
  }
  if (!Buffer.isBuffer(temp)) {
    throw new Error('Temp buffer must be a Buffer.');
  }
  // Temp buffer must be at least the same size as shards.
  if (temp.length < shards[0].length) {
    throw new Error('Temp buffer is too small.');
  }
  var toCheck = new Array(self.parityShards);
  self.copy(shards, self.dataShards, toCheck, 0, self.parityShards);
  return self.checkSomeShards(
    self.parityRows,
    shards,
    self.dataShards,
    toCheck,
    self.parityShards,
    offset,
    size,
    temp
  );
};

ReedSolomon.bindingJS = {
  mset: function(mtable, source, target, offset, length) {
    var blocks = Math.floor((length - offset) / 32);
    while (blocks--) {
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
      target[offset] = mtable[source[offset++]];
    }
    while (offset < length) {
      target[offset] = mtable[source[offset++]];
    }
  },
  mxor: function(mtable, source, target, offset, length) {
    var blocks = Math.floor((length - offset) / 32);
    while (blocks--) {
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
      target[offset] ^= mtable[source[offset++]];
    }
    while (offset < length) {
      target[offset] ^= mtable[source[offset++]];
    }
  }
};

try {
  ReedSolomon.bindingNative = require('./build/Release/binding');
} catch (exception) {
  // We use the Javascript binding if the native binding has not been compiled.
  ReedSolomon.bindingNative = undefined;
}

ReedSolomon.integer = function(value) {
  if (typeof value != 'number') return false;
  if (value < 0 || Math.floor(value) !== value) return false;
  return true;
};

// Create the matrix to use for encoding, given the number of data shards and
// the number of total shards. The top square of the matrix should be an
// identity matrix, so that the data shards are unchanged after encoding.
ReedSolomon.matrix = function(dataShards, totalShards) {
  if (!ReedSolomon.integer(dataShards)) {
    throw new Error('Argument dataShards must be a positive integer.');
  }
  if (!ReedSolomon.integer(totalShards)) {
    throw new Error('Argument totalShards must be a positive integer.');
  }
  // Start with a Vandermonde matrix. This matrix would work in theory, but does
  // not have the property that the data shards are unchanged after encoding.
  var vandermonde = ReedSolomon.vandermonde(totalShards, dataShards);
  // Multiple by the inverse of the top square of the matrix. This will make the
  // top square the identity matrix, but preserve the property that any square
  // subset of rows is invertible.
  var top = vandermonde.submatrix(0, 0, dataShards, dataShards);
  return vandermonde.times(top.invert());
};

// Create a Vandermonde matrix, which is guaranteed to have the property that
// any subset of rows that forms a square matrix is invertible.
ReedSolomon.vandermonde = function(rows, columns) {
  if (!ReedSolomon.integer(rows)) {
    throw new Error('Argument rows must be a positive integer.');
  }
  if (!ReedSolomon.integer(columns)) {
    throw new Error('Argument columns must be a positive integer.');
  }
  var result = new ReedSolomon.Matrix(rows, columns);
  for (var row = 0; row < rows; row++) {
    for (var column = 0; column < columns; column++) {
      result.set(row, column, ReedSolomon.Galois.exp(row, column));
    }
  }
  return result;
};

// 8-bit Galois field.
ReedSolomon.Galois = {};

// Inverse of the logarithm table. Maps integer logarithms to members of the
// field. There is no entry for 255 because the highest log is 254.
ReedSolomon.Galois.EXP_TABLE = new Buffer([
    1,   2,   4,   8,  16,  32,  64, 128,
   29,  58, 116, 232, 205, 135,  19,  38,
   76, 152,  45,  90, 180, 117, 234, 201,
  143,   3,   6,  12,  24,  48,  96, 192,
  157,  39,  78, 156,  37,  74, 148,  53,
  106, 212, 181, 119, 238, 193, 159,  35,
   70, 140,   5,  10,  20,  40,  80, 160,
   93, 186, 105, 210, 185, 111, 222, 161,
   95, 190,  97, 194, 153,  47,  94, 188,
  101, 202, 137,  15,  30,  60, 120, 240,
  253, 231, 211, 187, 107, 214, 177, 127,
  254, 225, 223, 163,  91, 182, 113, 226,
  217, 175,  67, 134,  17,  34,  68, 136,
   13,  26,  52, 104, 208, 189, 103, 206,
  129,  31,  62, 124, 248, 237, 199, 147,
   59, 118, 236, 197, 151,  51, 102, 204,
  133,  23,  46,  92, 184, 109, 218, 169,
   79, 158,  33,  66, 132,  21,  42,  84,
  168,  77, 154,  41,  82, 164,  85, 170,
   73, 146,  57, 114, 228, 213, 183, 115,
  230, 209, 191,  99, 198, 145,  63, 126,
  252, 229, 215, 179, 123, 246, 241, 255,
  227, 219, 171,  75, 150,  49,  98, 196,
  149,  55, 110, 220, 165,  87, 174,  65,
  130,  25,  50, 100, 200, 141,   7,  14,
   28,  56, 112, 224, 221, 167,  83, 166,
   81, 162,  89, 178, 121, 242, 249, 239,
  195, 155,  43,  86, 172,  69, 138,   9,
   18,  36,  72, 144,  61, 122, 244, 245,
  247, 243, 251, 235, 203, 139,  11,  22,
   44,  88, 176, 125, 250, 233, 207, 131,
   27,  54, 108, 216, 173,  71, 142,
   // Repeat the table so that multiply() does not have to check bounds.
    1,   2,   4,   8,  16,  32,  64, 128,
   29,  58, 116, 232, 205, 135,  19,  38,
   76, 152,  45,  90, 180, 117, 234, 201,
  143,   3,   6,  12,  24,  48,  96, 192,
  157,  39,  78, 156,  37,  74, 148,  53,
  106, 212, 181, 119, 238, 193, 159,  35,
   70, 140,   5,  10,  20,  40,  80, 160,
   93, 186, 105, 210, 185, 111, 222, 161,
   95, 190,  97, 194, 153,  47,  94, 188,
  101, 202, 137,  15,  30,  60, 120, 240,
  253, 231, 211, 187, 107, 214, 177, 127,
  254, 225, 223, 163,  91, 182, 113, 226,
  217, 175,  67, 134,  17,  34,  68, 136,
   13,  26,  52, 104, 208, 189, 103, 206,
  129,  31,  62, 124, 248, 237, 199, 147,
   59, 118, 236, 197, 151,  51, 102, 204,
  133,  23,  46,  92, 184, 109, 218, 169,
   79, 158,  33,  66, 132,  21,  42,  84,
  168,  77, 154,  41,  82, 164,  85, 170,
   73, 146,  57, 114, 228, 213, 183, 115,
  230, 209, 191,  99, 198, 145,  63, 126,
  252, 229, 215, 179, 123, 246, 241, 255,
  227, 219, 171,  75, 150,  49,  98, 196,
  149,  55, 110, 220, 165,  87, 174,  65,
  130,  25,  50, 100, 200, 141,   7,  14,
   28,  56, 112, 224, 221, 167,  83, 166,
   81, 162,  89, 178, 121, 242, 249, 239,
  195, 155,  43,  86, 172,  69, 138,   9,
   18,  36,  72, 144,  61, 122, 244, 245,
  247, 243, 251, 235, 203, 139,  11,  22,
   44,  88, 176, 125, 250, 233, 207, 131,
   27,  54, 108, 216, 173,  71, 142
]);

// The number of elements in the field.
ReedSolomon.Galois.FIELD_SIZE = 256;

// The polynomial used to generate the logarithm table. There are a number of
// polynomials that work to generate a Galois field of 256 elements. The choice
// is arbitrary, and we use the first one.
// The possibilities are:
// 29, 43, 45, 77, 95, 99, 101, 105, 113, 135, 141, 169, 195, 207, 231, 245
ReedSolomon.Galois.GENERATING_POLYNOMIAL = 29;

// Map members of the Galois Field to their integer logarithms. The entry at
// index 0 is never used because there is no log of 0.
ReedSolomon.Galois.LOG_TABLE = new Buffer([
    0,   0,   1,  25,   2,  50,  26, 198,
    3, 223,  51, 238,  27, 104, 199,  75,
    4, 100, 224,  14,  52, 141, 239, 129,
   28, 193, 105, 248, 200,   8,  76, 113,
    5, 138, 101,  47, 225,  36,  15,  33,
   53, 147, 142, 218, 240,  18, 130,  69,
   29, 181, 194, 125, 106,  39, 249, 185,
  201, 154,   9, 120,  77, 228, 114, 166,
    6, 191, 139,  98, 102, 221,  48, 253,
  226, 152,  37, 179,  16, 145,  34, 136,
   54, 208, 148, 206, 143, 150, 219, 189,
  241, 210,  19,  92, 131,  56,  70,  64,
   30,  66, 182, 163, 195,  72, 126, 110,
  107,  58,  40,  84, 250, 133, 186,  61,
  202,  94, 155, 159,  10,  21, 121,  43,
   78, 212, 229, 172, 115, 243, 167,  87,
    7, 112, 192, 247, 140, 128,  99,  13,
  103,  74, 222, 237,  49, 197, 254,  24,
  227, 165, 153, 119,  38, 184, 180, 124,
   17,  68, 146, 217,  35,  32, 137,  46,
   55,  63, 209,  91, 149, 188, 207, 205,
  144, 135, 151, 178, 220, 252, 190,  97,
  242,  86, 211, 171,  20,  42,  93, 158,
  132,  60,  57,  83,  71, 109,  65, 162,
   31,  45,  67, 216, 183, 123, 164, 118,
  196,  23,  73, 236, 127,  12, 111, 246,
  108, 161,  59,  82,  41, 157,  85, 170,
  251,  96, 134, 177, 187, 204,  62,  90,
  203,  89,  95, 176, 156, 169, 160,  81,
   11, 245,  22, 235, 122, 117,  44, 215,
   79, 174, 213, 233, 230, 231, 173, 232,
  116, 214, 244, 234, 168,  80,  88, 175
]);

// Add two elements of the field.
ReedSolomon.Galois.add = function(a, b) {
  return a ^ b;
};

// Inverse of multiplication.
ReedSolomon.Galois.divide = function(a, b) {
  if (a === 0) return 0;
  if (b === 0) throw new Error('Divisor cannot be 0.');
  var logA = ReedSolomon.Galois.LOG_TABLE[a];
  var logB = ReedSolomon.Galois.LOG_TABLE[b];
  var logResult = logA - logB;
  if (logResult < 0) logResult += 255;
  return ReedSolomon.Galois.EXP_TABLE[logResult];
};

// Computes a**n. The result of multiplying a by itself n times.
ReedSolomon.Galois.exp = function(a, n) {
  if (n === 0) return 1;
  if (a === 0) return 0;
  var logA = ReedSolomon.Galois.LOG_TABLE[a];
  var logResult = logA * n;
  while (logResult >= 255) logResult -= 255;
  return ReedSolomon.Galois.EXP_TABLE[logResult];
};

// Multiplies two elements of the field.
ReedSolomon.Galois.multiply = function(a, b) {
  if (a === 0 || b === 0) {
    return 0;
  } else {
    var logA = ReedSolomon.Galois.LOG_TABLE[a];
    var logB = ReedSolomon.Galois.LOG_TABLE[b];
    var logResult = logA + logB;
    return ReedSolomon.Galois.EXP_TABLE[logResult];
  }
};

// Inverse of addition.
ReedSolomon.Galois.subtract = function(a, b) {
  return a ^ b;
};

// Generates the inverse log table.
ReedSolomon.Galois.generateExpTable = function(logTable) {
  var result = new Buffer(ReedSolomon.Galois.FIELD_SIZE * 2 - 2);
  result.fill(0);
  for (var i = 1; i < ReedSolomon.Galois.FIELD_SIZE; i++) {
    var log = logTable[i];
    result[log] = i;
    result[log + ReedSolomon.Galois.FIELD_SIZE - 1] = i;
  }
  return result;
};

// Generates the logarithm table given a starting polynomial.
ReedSolomon.Galois.generateLogTable = function(polynomial) {
  var result = new Buffer(ReedSolomon.Galois.FIELD_SIZE);
  result.fill(0);
  var b = 1;
  for (var log = 0; log < ReedSolomon.Galois.FIELD_SIZE - 1; log++) {
    if (result[b] !== 0) {
      throw new Error('Detected a duplicate logarithm. Bad polynomial?');
    }
    result[b] = log;
    b = (b << 1);
    if (ReedSolomon.Galois.FIELD_SIZE <= b) {
      b = ((b - ReedSolomon.Galois.FIELD_SIZE) ^ polynomial);
    }
  }
  return result;
};

// Generates the multiplication table.
ReedSolomon.Galois.generateMultiplyTable = function() {
  var size = ReedSolomon.Galois.FIELD_SIZE;
  var result = new Array(size);
  for (var a = 0; a < size; a++) {
    result[a] = new Buffer(size);
    for (var b = 0; b < size; b++) {
      result[a][b] = ReedSolomon.Galois.multiply(a, b);
    }
  }
  return result;
};

// A multiplication table for the Galois field. This table is an alternative to
// using the multiply() method, which is implemented with log/exp table lookups.
ReedSolomon.Galois.MULTIPLY_TABLE = ReedSolomon.Galois.generateMultiplyTable();

// Matrix algebra over an 8-bit Galois field.
// This class is not performance-critical, so the implementation is simple.
ReedSolomon.Matrix = function(initRows, initColumns) {
  var self = this;
  if (arguments.length === 2) {
    // Initialize a matrix of zeroes.
    if (!ReedSolomon.integer(initRows)) {
      throw new Error('Argument initRows must be a positive integer.');
    }
    if (!ReedSolomon.integer(initColumns)) {
      throw new Error('Argument initColumns must be a positive integer.');
    }
    self.rows = initRows;
    self.columns = initColumns;
    // The data in the matrix, in row major form.
    // To get element (row, column): data[row][column]
    // The indices for both row and column start at 0.
    self.data = new Array(self.rows);
    for (var row = 0; row < self.rows; row++) {
      self.data[row] = new Buffer(self.columns);
      self.data[row].fill(0); // The matrix must be a matrix of zeroes.
    }
  } else {
    // Initialize a matrix with the given row-major data.
    var initData = arguments[0];
    if (!initData || initData.constructor !== Array) {
      throw new Error('Argument initData must be an Array.');
    }
    self.rows = initData.length;
    for (var row = 0; row < self.rows; row++) {
      if (!Buffer.isBuffer(initData[row])) {
        throw new Error('All rows must be Buffers.');
      }
    }
    self.columns = initData[0].length;
    self.data = new Array(self.rows);
    for (var row = 0; row < self.rows; row++) {
      if (initData[row].length != self.columns) {
        throw new Error('All rows must have the same number of columns.');
      }
      self.data[row] = new Buffer(self.columns);
      for (var column = 0; column < self.columns; column++) {
        self.data[row][column] = initData[row][column];
      }
    }
  }
};

// Returns the concatenation of this matrix and the matrix on the right.
ReedSolomon.Matrix.prototype.augment = function(right) {
  var self = this;
  if (self.rows != right.rows) {
    throw new Error('Matrices do not have the same number of rows.');
  }
  var result = new ReedSolomon.Matrix(self.rows, self.columns + right.columns);
  for (var row = 0; row < self.rows; row++) {
    for (var column = 0; column < self.columns; column++) {
      result.data[row][column] = self.data[row][column];
    }
    for (var column = 0; column < right.columns; column++) {
      result.data[row][self.columns + column] = right.data[row][column];
    }
  }
  return result;
};

// Does the work of matrix inversion.
// Assumes that this is an r by 2r matrix.
ReedSolomon.Matrix.prototype.gaussianElimination = function() {
  var self = this;
  // Clear the area below the main diagonal and scale the main diagonal to be 1.
  for (var row = 0; row < self.rows; row++) {
    // If the element on the diagonal is 0,
    // find a row below with a non-zero and swap them.
    if (self.data[row][row] === 0) {
      for (var rowBelow = row + 1; rowBelow < self.rows; rowBelow++) {
        if (self.data[rowBelow][row] !== 0) {
          self.swapRows(row, rowBelow);
          break;
        }
      }
    }
    // If we could not find one, the matrix is singular.
    if (self.data[row][row] === 0) {
      throw new Error('Matrix is singular.');
    }
    // Scale to 1.
    if (self.data[row][row] !== 1) {
      var scale = ReedSolomon.Galois.divide(1, self.data[row][row]);
      for (column = 0; column < self.columns; column++) {
        self.data[row][column] = ReedSolomon.Galois.multiply(
          self.data[row][column],
          scale
        );
      }
    }
    // Make everything below the 1 be a 0 by subtracting a multiple of it.
    // Subtraction and addition are both implemented with xor in a Galois field.
    for (var rowBelow = row + 1; rowBelow < self.rows; rowBelow++) {
      if (self.data[rowBelow][row] !== 0) {
        var scale = self.data[rowBelow][row];
        for (var column = 0; column < self.columns; column++) {
          self.data[rowBelow][column] ^= ReedSolomon.Galois.multiply(
            scale,
            self.data[row][column]
          );
        }
      }
    }
  }
  // Clear the area above the main diagonal.
  for (var row = 0; row < self.rows; row++) {
    for (var rowAbove = 0; rowAbove < row; rowAbove++) {
      if (self.data[rowAbove][row] !== 0) {
        var scale = self.data[rowAbove][row];
        for (var column = 0; column < self.columns; column++) {
          self.data[rowAbove][column] ^= ReedSolomon.Galois.multiply(
            scale,
            self.data[row][column]
          );
        }
      }
    }
  }
};

// Returns the value at row r and column c.
ReedSolomon.Matrix.prototype.get = function(row, column) {
  var self = this;
  if (!ReedSolomon.integer(row) || self.rows <= row) {
    throw new Error('Row index is out of range: ' + row);
  }
  if (!ReedSolomon.integer(column) || self.columns <= column) {
    throw new Error('Column index is out of range: ' + column);
  }
  return self.data[row][column];
};

// Returns one row of the matrix as a buffer.
ReedSolomon.Matrix.prototype.getRow = function(row) {
  var self = this;
  var result = new Buffer(self.columns);
  for (var column = 0; column < self.columns; column++) {
    result[column] = self.get(row, column);
  }
  return result;
};

// Returns the inverse of the matrix.
ReedSolomon.Matrix.prototype.invert = function() {
  var self = this;
  if (self.rows != self.columns) {
    throw new Error('Only square matrices can be inverted.');
  }
  // Create a working matrix by augmenting with an identity matrix on the right.
  var work = self.augment(ReedSolomon.Matrix.identity(self.rows));
  // Do Gaussian elimination to transform the left half into an identity matrix.
  work.gaussianElimination();
  // The right half is now the inverse.
  return work.submatrix(0, self.rows, self.columns, self.columns * 2);
};

// Sets the value at row r, column c.
ReedSolomon.Matrix.prototype.set = function(row, column, value) {
  var self = this;
  if (!ReedSolomon.integer(row) || self.rows <= row) {
    throw new Error('Row index is out of range: ' + row);
  }
  if (!ReedSolomon.integer(column) || self.columns <= column) {
    throw new Error('Column index is out of range: ' + column);
  }
  self.data[row][column] = value;
};

// Returns a part of this matrix.
ReedSolomon.Matrix.prototype.submatrix = function(rmin, cmin, rmax, cmax) {
  var self = this;
  var result = new ReedSolomon.Matrix(rmax - rmin, cmax - cmin);
  for (var row = rmin; row < rmax; row++) {
    for (var column = cmin; column < cmax; column++) {
      result.data[row - rmin][column - cmin] = self.data[row][column];
    }
  }
  return result;
};

// Exchanges two rows in the matrix.
ReedSolomon.Matrix.prototype.swapRows = function(row1, row2) {
  var self = this;
  if (!ReedSolomon.integer(row1) || row1 >= self.rows) {
    throw new Error('Row index 1 is out of range.');
  }
  if (!ReedSolomon.integer(row2) || row2 >= self.rows) {
    throw new Error('Row index 2 is out of range.');
  }
  var temp = self.data[row1];
  self.data[row1] = self.data[row2];
  self.data[row2] = temp;
};

// Multiplies this matrix (on the left) by another matrix (on the right).
ReedSolomon.Matrix.prototype.times = function(right) {
  var self = this;
  if (self.columns != right.rows) {
    throw new Error(
      'Number of columns on left (' + self.columns + ') ' +
      'must be equal to number of rows on right (' + right.rows + ').'
    );
  }
  var result = new ReedSolomon.Matrix(self.rows, right.columns);
  for (var row = 0; row < self.rows; row++) {
    for (var column = 0; column < right.columns; column++) {
      var value = 0;
      for (var index = 0; index < self.columns; index++) {
        value ^= ReedSolomon.Galois.multiply(
          self.get(row, index),
          right.get(index, column)
        );
      }
      result.set(row, column, value);
    }
  }
  return result;
};

// Returns a human-readable string of the matrix contents.
ReedSolomon.Matrix.prototype.toString = function() {
  var self = this;
  var result = [];
  result.push('[');
  for (var row = 0; row < self.rows; row++) {
    if (row !== 0) result.push(', ');
    result.push('[');
    for (var column = 0; column < self.columns; column++) {
      if (column !== 0) result.push(', ');
      result.push(self.data[row][column]);
    }
    result.push(']');
  }
  result.push(']');
  return result.join('');
};

// Returns an identity matrix of the given size.
ReedSolomon.Matrix.identity = function(size) {
  var self = this;
  var result = new ReedSolomon.Matrix(size, size);
  for (var index = 0; index < size; index++) {
    result.set(index, index, 1);
  }
  return result;
};

module.exports = ReedSolomon;

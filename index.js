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
  self.binding = (
    binding || ReedSolomon.binding.native || ReedSolomon.binding.javascript
  );
  self.dataShards = dataShards;
  self.parityShards = parityShards;
  self.totalShards = self.dataShards + self.parityShards;
  if (typeof self.binding != 'object') {
    throw new Error('binding must be provided');
  }
  if (typeof self.binding.encode != 'function') {
    throw new Error('binding must have an encode method');
  }
  ReedSolomon.assertInteger('dataShards', self.dataShards);
  ReedSolomon.assertInteger('parityShards', self.parityShards);
  ReedSolomon.assertInteger('totalShards', self.totalShards);
  if (self.dataShards === 0) throw new Error('dataShards must be > 0');
  if (self.parityShards === 0) throw new Error('parityShards must be > 0');
  if (self.totalShards === 0) throw new Error('totalShards must be > 0');
  if (self.dataShards > 30) throw new Error('dataShards must be <= 30');
  if (self.parityShards > 30) throw new Error('parityShards must be <= 30');
  if (self.totalShards > 31) {
    // The Vandermonde matrix is guaranteed for 256 rows.
    // We use a 31-bit integer to represent sources and targets.
    // This is more efficient in Javascript than a 32-bit integer or Array.
    // After the 256 shard limit, this imposes a 31 shard limit.
    // ReedSolomon on 20+ shards is slow and not to be encouraged.
    throw new Error('dataShards + parityShards must be at most 31 shards');
  }
  self.matrix = ReedSolomon.matrix(self.dataShards, self.totalShards);
  self.parityRows = Buffer.alloc(self.dataShards * self.parityShards);
  for (var index = 0; index < self.parityShards; index++) {
    var row = self.matrix.getRow(self.dataShards + index);
    row.copy(self.parityRows, index * row.length);
  }
  self.rowSize = self.dataShards;
};

// Checks the consistency of arguments passed to public methods.
ReedSolomon.prototype.checkArguments = function(
  buffer,
  bufferOffset,
  bufferSize,
  shardLength,
  shardOffset,
  shardSize,
  targets,
  end
) {
  var self = this;
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('buffer must be a buffer');
  }
  ReedSolomon.assertInteger('bufferOffset', bufferOffset);
  ReedSolomon.assertInteger('bufferSize', bufferSize);
  ReedSolomon.assertInteger(
    'bufferOffset + bufferSize',
    bufferOffset + bufferSize
  );
  ReedSolomon.assertInteger('shardLength', shardLength);
  ReedSolomon.assertInteger('shardOffset', shardOffset);
  ReedSolomon.assertInteger('shardSize', shardSize);
  ReedSolomon.assertInteger(
    'shardOffset + shardSize',
    shardOffset + shardSize
  );
  ReedSolomon.assertBits('targets' + targets, targets);
  if (typeof end != 'function') {
    throw new Error('callback must be a function');
  }
  if (bufferOffset + bufferSize > buffer.length) {
    throw new Error(
      'bufferOffset=' + bufferOffset + ' + bufferSize=' + bufferSize +
      ' > buffer.length=' + buffer.length
    );
  }
  if (bufferSize !== (shardLength * self.totalShards)) {
    throw new Error(
      'bufferSize must be the product of shardLength and totalShards'
    );
  }
  if (shardOffset + shardSize > shardLength) {
    throw new Error(
      'shardOffset=' + shardOffset + ' + shardSize=' + shardSize +
      ' > shardLength=' + shardLength
    );
  }
  if (ReedSolomon.indexMSB(targets) + 1 > self.totalShards) {
    throw new Error('targets > totalShards');
  }
  if (ReedSolomon.countBits(targets) > self.parityShards) {
    throw new Error('not enough shards present to recover data');
  }
};

// Given a list of shards, some of which contain data, fills in the shards which
// do not contain data. Returns quickly if all the shards are present.
ReedSolomon.prototype.decode = function(
  buffer,
  bufferOffset,
  bufferSize,
  shardLength,
  shardOffset,
  shardSize,
  targets,
  end
) {
  var self = this;
  self.checkArguments(
    buffer,
    bufferOffset,
    bufferSize,
    shardLength,
    shardOffset,
    shardSize,
    targets,
    end
  );
  if (targets === 0) return end();
  function decodeDataShards() {
    // If no data shards need to be decoded then we can move on:
    var dataShardsMissing = 0;
    for (var shardIndex = 0; shardIndex < self.dataShards; shardIndex++) {
      if (targets & (1 << shardIndex)) dataShardsMissing++;
    }
    if (dataShardsMissing === 0) return decodeParityShards();
    // Pull out the rows of the matrix that correspond to the shards that we
    // have and build a square matrix:
    var subMatrix = new ReedSolomon.Matrix(self.dataShards, self.dataShards);
    // Pull out an array holding just the shards that correspond to the rows of
    // the submatrix. These shards will be the input to the decoding process
    // that recreates the missing data shards.
    var dataSources = 0;
    var count = 0;
    var shardIndex = 0;
    while (shardIndex < self.totalShards && count < self.dataShards) {
      if (!(targets & (1 << shardIndex))) {
        // Shard is present and does not need to be decoded.
        dataSources |= (1 << shardIndex);
        for (var column = 0; column < self.dataShards; column++) {
          subMatrix.set(
            count,
            column,
            self.matrix.get(shardIndex, column)
          );
        }
        count++;
      }
      shardIndex++;
    }
    // Invert the matrix, so that we can go from the encoded shards back to the
    // original data. Then pull out the row that generates the shard that we
    // want to decode. Note that since this matrix maps back to the orginal
    // data, it can be used to create a data shard, but not a parity shard.
    var dataMatrix = subMatrix.invert();
    // Recreate any data shards that were missing. The inputs to the coding are
    // the shards we actually have, and the outputs are the missing data shards.
    // The computation is done using the special decode matrix we just built.
    var rows = Buffer.alloc(dataShardsMissing * self.dataShards);
    var rowsOffset = 0;
    var dataTargets = 0;
    for (var shardIndex = 0; shardIndex < self.dataShards; shardIndex++) {
      if (targets & (1 << shardIndex)) {
        // Shard is not present and needs to be decoded.
        dataTargets |= (1 << shardIndex);
        dataMatrix.getRow(shardIndex).copy(rows, rowsOffset);
        rowsOffset += self.rowSize;
      }
    }
    if (ReedSolomon.countBits(dataTargets) > self.parityShards) {
      throw new Error('dataTargets > parityShards');
    }
    self.binding.encode(
      ReedSolomon.Galois.TABLE,
      rows,
      self.rowSize,
      buffer,
      bufferOffset,
      bufferSize,
      shardLength,
      shardOffset,
      shardSize,
      dataSources,
      dataTargets,
      decodeParityShards
    );
  }
  function decodeParityShards(error) {
    if (error) return end(error);
    // If no parity shards need to be decoded then we are done:
    var parityShardsMissing = 0;
    var shardIndex = self.dataShards;
    while (shardIndex < self.totalShards) {
      if (targets & (1 << shardIndex)) parityShardsMissing++;
      shardIndex++;
    }
    if (parityShardsMissing === 0) return end();
    // Now that we have all of the data shards intact, we can compute any of the
    // parity shards that are missing. The inputs to the coding are all of the
    // data shards, including any that we have just calculated. The outputs are
    // all the parity shards which were missing.
    var rows = Buffer.alloc(parityShardsMissing * self.dataShards);
    var rowsOffset = 0;
    var paritySources = Math.pow(2, self.dataShards) - 1;
    var parityTargets = 0;
    var shardIndex = self.dataShards;
    while (shardIndex < self.totalShards) {
      if (targets & (1 << shardIndex)) {
        parityTargets |= (1 << shardIndex);
        self.parityRows.copy(
          rows,
          rowsOffset,
          (shardIndex - self.dataShards) * self.rowSize,
          (shardIndex - self.dataShards + 1) * self.rowSize
        );
        rowsOffset += self.rowSize;
      }
      shardIndex++;
    }
    if (ReedSolomon.countBits(parityTargets) > self.parityShards) {
      throw new Error('parityTargets > parityShards');
    }
    self.binding.encode(
      ReedSolomon.Galois.TABLE,
      rows,
      self.rowSize,
      buffer,
      bufferOffset,
      bufferSize,
      shardLength,
      shardOffset,
      shardSize,
      paritySources,
      parityTargets,
      end
    );
  }
  decodeDataShards();
};

// Encodes the parity shards for a set of data shards.
ReedSolomon.prototype.encode = function(
  buffer, bufferOffset, bufferSize, shardLength, shardOffset, shardSize, end
) {
  var self = this;
  self.checkArguments(
    buffer,
    bufferOffset,
    bufferSize,
    shardLength,
    shardOffset,
    shardSize,
    0,
    end
  );
  // Use all data shards as sources:
  var sources = Math.pow(2, self.dataShards) - 1;
  // Use all parity shards as targets:
  var targets = Math.pow(2, self.totalShards) - 1 - sources;
  ReedSolomon.assertBits('sources', sources);
  ReedSolomon.assertBits('targets', targets);
  self.binding.encode(
    ReedSolomon.Galois.TABLE,
    self.parityRows,
    self.rowSize,
    buffer,
    bufferOffset,
    bufferSize,
    shardLength,
    shardOffset,
    shardSize,
    sources,
    targets,
    end
  );
};

ReedSolomon.assertBits = function(key, value) {
  ReedSolomon.assertInteger(key, value);
  if (value > 2147483647) {
    throw new Error(key + ' > 31 shards: ' + value);
  }
};

ReedSolomon.assertBuffer = function(key, value) {
  if (!Buffer.isBuffer(value)) {
    throw new Error(key + ' must be a buffer');
  }
};

ReedSolomon.assertInteger = function(key, value) {
  if (typeof value != 'number') {
    throw new Error(key + ' must be a number');
  }
  if (value < 0) {
    throw new Error(key + ' must be positive: ' + value);
  }
  if (Math.floor(value) !== value) {
    throw new Error(key + ' must be an integer: ' + value);
  }
  if (value > 4294967295) {
    throw new Error(key + ' must be a 32-bit integer: ' + value);
  }
};

ReedSolomon.binding = {};

ReedSolomon.binding.javascript = {
  checkArguments: function(
    tables,
    rows,
    rowSize,
    buffer,
    bufferOffset,
    bufferSize,
    shardLength,
    shardOffset,
    shardSize,
    sources,
    targets,
    end
  ) {
    ReedSolomon.assertBuffer('tables', tables);
    ReedSolomon.assertBuffer('rows', rows);
    ReedSolomon.assertInteger('rowSize', rowSize);
    ReedSolomon.assertBuffer('buffer', buffer);
    ReedSolomon.assertInteger('bufferOffset', bufferOffset);
    ReedSolomon.assertInteger('bufferSize', bufferSize);
    ReedSolomon.assertInteger('shardLength', shardLength);
    ReedSolomon.assertInteger('shardOffset', shardOffset);
    ReedSolomon.assertInteger('shardSize', shardSize);
    ReedSolomon.assertBits('sources', sources);
    ReedSolomon.assertBits('targets', targets);
    if (typeof end != 'function') {
      throw new Error('callback must be a function');
    }
    if (tables.length != 65536) {
      throw new Error('tables length != 256 x 256');
    }
    if (bufferOffset + bufferSize > buffer.length) {
      throw new Error('bufferOffset + bufferSize > buffer.length');
    }
    if (shardLength > 0 && (bufferSize % shardLength) !== 0) {
      throw new Error('bufferSize must be a multiple of shardLength');
    }
    if (shardLength === 0 && bufferSize !== 0) {
      throw new Error('shardLength === 0 && bufferSize !== 0');
    }
    if (shardOffset + shardSize > shardLength) {
      throw new Error('shardOffset + shardSize > shardLength');
    }
    if (sources === 0) {
      throw new Error('sources == 0 shards');
    }
    if (targets === 0) {
      throw new Error('targets == 0 shards');
    }
    if (sources > 2147483647) {
      throw new Error('sources > 31 shards');
    }
    if (targets > 2147483647) {
      throw new Error('targets > 31 shards');
    }
    if ((sources & targets) !== 0) {
      throw new Error('sources cannot be targets');
    }
    if (
      (ReedSolomon.indexMSB(sources) * shardLength) + shardLength > bufferSize
    ) {
      throw new Error('buffer would overflow (too many sources)');
    }
    if (
      (ReedSolomon.indexMSB(targets) * shardLength) + shardLength > bufferSize
    ) {
      throw new Error('buffer would overflow (too many targets)');
    }
    if (rows.length != ReedSolomon.countBits(targets) * rowSize) {
      throw new Error('rows length != number of targets * rowSize');
    }
    if (rowSize != ReedSolomon.countBits(sources)) {
      throw new Error('rowSize != number of sources');
    }
  },

  encode: function(
    tables,
    rows,
    rowSize,
    buffer,
    bufferOffset,
    bufferSize,
    shardLength,
    shardOffset,
    shardSize,
    sources,
    targets,
    end
  ) {
    var self = this;
    self.checkArguments(
      tables,
      rows,
      rowSize,
      buffer,
      bufferOffset,
      bufferSize,
      shardLength,
      shardOffset,
      shardSize,
      sources,
      targets,
      end
    );
    var targetCount = 0;
    for (var targetIndex = 0; targetIndex < 31; targetIndex++) {
      if (targets & (1 << targetIndex)) {
        var rowOffset = targetCount * rowSize;
        var targetOffset = bufferOffset + (targetIndex * shardLength);
        var target = buffer.slice(targetOffset, targetOffset + shardLength);
        var sourceCount = 0;
        for (var sourceIndex = 0; sourceIndex < 31; sourceIndex++) {
          if (sources & (1 << sourceIndex)) {
            var tablesOffset = rows[rowOffset + sourceCount] * 256;
            var table = tables.slice(tablesOffset, tablesOffset + 256);
            var sourceOffset = bufferOffset + (sourceIndex * shardLength);
            var source = buffer.slice(sourceOffset, sourceOffset + shardLength);
            if (sourceCount === 0) {
              self.mset(
                table,
                source,
                target,
                shardOffset,
                shardOffset + shardSize
              );
            } else {
              self.mxor(
                table,
                source,
                target,
                shardOffset,
                shardOffset + shardSize
              );
            }
            sourceCount++;
          }
        }
        targetCount++;
      }
    }
    end();
  },

  mset: function(table, source, target, offset, length) {
    var blocks = Math.floor((length - offset) / 32);
    while (blocks--) {
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
      target[offset] = table[source[offset++]];
    }
    while (offset < length) {
      target[offset] = table[source[offset++]];
    }
  },

  mxor: function(table, source, target, offset, length) {
    var blocks = Math.floor((length - offset) / 32);
    while (blocks--) {
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
      target[offset] ^= table[source[offset++]];
    }
    while (offset < length) {
      target[offset] ^= table[source[offset++]];
    }
  }
};

try {
  ReedSolomon.binding.native = require('./binding.node');
} catch (exception) {
  // We use the Javascript binding if the native binding has not been compiled.
}

ReedSolomon.countBits = function(bits) {
  // Count the number of bits set.
  ReedSolomon.assertBits('bits', bits);
  for (var count = 0; bits; count++) {
    bits &= bits - 1;
  }
  return count;
};

ReedSolomon.indexMSB = function(bits) {
  // Find the index of the most significant bit.
  ReedSolomon.assertBits('bits', bits);
  var index = 31;
  while (index--) {
    if (bits & (1 << index)) return index;
  }
  return -1;
};

// Create the matrix to use for encoding, given the number of data shards and
// the number of total shards. The top square of the matrix should be an
// identity matrix, so that the data shards are unchanged after encoding.
ReedSolomon.matrix = function(dataShards, totalShards) {
  ReedSolomon.assertInteger('dataShards', dataShards);
  ReedSolomon.assertInteger('totalShards', totalShards);
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
  ReedSolomon.assertInteger('rows', rows);
  ReedSolomon.assertInteger('columns', columns);
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
ReedSolomon.Galois.EXP_TABLE = Buffer.from([
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
ReedSolomon.Galois.LOG_TABLE = Buffer.from([
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
  if (b === 0) throw new Error('divisor cannot be 0');
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
  var result = Buffer.alloc(ReedSolomon.Galois.FIELD_SIZE * 2 - 2);
  for (var i = 1; i < ReedSolomon.Galois.FIELD_SIZE; i++) {
    var log = logTable[i];
    result[log] = i;
    result[log + ReedSolomon.Galois.FIELD_SIZE - 1] = i;
  }
  return result;
};

// Generates the logarithm table given a starting polynomial.
ReedSolomon.Galois.generateLogTable = function(polynomial) {
  var result = Buffer.alloc(ReedSolomon.Galois.FIELD_SIZE);
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
ReedSolomon.Galois.generateMultiplicationTable = function() {
  var size = ReedSolomon.Galois.FIELD_SIZE;
  var table = Buffer.alloc(size * size);
  var offset = 0;
  for (var a = 0; a < size; a++) {
    for (var b = 0; b < size; b++) {
      table[offset++] = ReedSolomon.Galois.multiply(a, b);
    }
  }
  return table;
};

// A multiplication table for the Galois field. This table is an alternative to
// using the multiply() method, which is implemented with log/exp table lookups.
ReedSolomon.Galois.TABLE = ReedSolomon.Galois.generateMultiplicationTable();

// Matrix algebra over an 8-bit Galois field.
// This class is not performance-critical, so the implementation is simple.
ReedSolomon.Matrix = function(initRows, initColumns) {
  var self = this;
  if (arguments.length === 2) {
    // Initialize a matrix of zeroes.
    ReedSolomon.assertInteger('initRows', initRows);
    ReedSolomon.assertInteger('initColumns', initColumns);
    self.rows = initRows;
    self.columns = initColumns;
    // The data in the matrix, in row major form.
    // To get element (row, column): data[row][column]
    // The indices for both row and column start at 0.
    self.data = new Array(self.rows);
    for (var row = 0; row < self.rows; row++) {
      // The matrix must be a matrix of zeroes.
      self.data[row] = Buffer.alloc(self.columns);
    }
  } else {
    // Initialize a matrix with the given row-major data.
    var initData = arguments[0];
    if (!initData || initData.constructor !== Array) {
      throw new Error('initData must be an Array');
    }
    self.rows = initData.length;
    for (var row = 0; row < self.rows; row++) {
      if (!Buffer.isBuffer(initData[row])) {
        throw new Error('all rows must be Buffers');
      }
    }
    self.columns = initData[0].length;
    self.data = new Array(self.rows);
    for (var row = 0; row < self.rows; row++) {
      if (initData[row].length != self.columns) {
        throw new Error('all rows must have the same number of columns');
      }
      self.data[row] = Buffer.alloc(self.columns);
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
    throw new Error('matrices do not have the same number of rows');
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
      throw new Error('matrix is singular');
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
  ReedSolomon.assertInteger('row', row);
  ReedSolomon.assertInteger('column', column);
  if (self.rows <= row) {
    throw new Error('row index is out of range: ' + row);
  }
  if (self.columns <= column) {
    throw new Error('column index is out of range: ' + column);
  }
  return self.data[row][column];
};

// Returns one row of the matrix as a buffer.
ReedSolomon.Matrix.prototype.getRow = function(row) {
  var self = this;
  var result = Buffer.alloc(self.columns);
  for (var column = 0; column < self.columns; column++) {
    result[column] = self.get(row, column);
  }
  return result;
};

// Returns the inverse of the matrix.
ReedSolomon.Matrix.prototype.invert = function() {
  var self = this;
  if (self.rows != self.columns) {
    throw new Error('only square matrices can be inverted');
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
  ReedSolomon.assertInteger('row', row);
  ReedSolomon.assertInteger('column', column);
  if (self.rows <= row) {
    throw new Error('row index is out of range: ' + row);
  }
  if (self.columns <= column) {
    throw new Error('column index is out of range: ' + column);
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
  ReedSolomon.assertInteger('row1', row1);
  ReedSolomon.assertInteger('row2', row2);
  if (row1 >= self.rows) {
    throw new Error('row index 1 is out of range');
  }
  if (row2 >= self.rows) {
    throw new Error('row index 2 is out of range');
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

// S.D.G.

#include <nan.h>
#include <stdint.h>

void mset(
  const uint8_t* table,
  const uint8_t* source,
  uint8_t* target,
  uint32_t offset,
  const uint32_t length
) {
  uint32_t iterations = (length - offset) / 16;
  target += offset;
  source += offset;
  while (iterations--) {
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    *target++ = *(table + *source++);
    offset += 16;
  }
  while (offset++ < length) {
    *target++ = *(table + *source++);
  }
}

void mxor(
  const uint8_t* table,
  const uint8_t* source,
  uint8_t* target,
  uint32_t offset,
  const uint32_t length
) {
  uint32_t iterations = (length - offset) / 16;
  target += offset;
  source += offset;
  while (iterations--) {
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    *target++ ^= *(table + *source++);
    offset += 16;
  }
  while (offset++ < length) {
    *target++ ^= *(table + *source++);
  }
}

class EncodeWorker : public Nan::AsyncWorker {
 public:
  EncodeWorker(
    v8::Local<v8::Object> &tablesHandle,
    v8::Local<v8::Object> &rowsHandle,
    const uint32_t rowSize,
    v8::Local<v8::Object> &bufferHandle,
    const uint32_t bufferOffset,
    const uint32_t shardLength,
    const uint32_t shardOffset,
    const uint32_t shardSize,
    const uint32_t sources,
    const uint32_t targets,
    Nan::Callback *end
  ) : Nan::AsyncWorker(end),
      rowSize(rowSize),
      bufferOffset(bufferOffset),
      shardLength(shardLength),
      shardOffset(shardOffset),
      shardSize(shardSize),
      sources(sources),
      targets(targets) {
        SaveToPersistent("tablesHandle", tablesHandle);
        SaveToPersistent("rowsHandle", rowsHandle);
        SaveToPersistent("bufferHandle", bufferHandle);
        tables = reinterpret_cast<const uint8_t*>(
          node::Buffer::Data(tablesHandle)
        );
        rows = reinterpret_cast<const uint8_t*>(node::Buffer::Data(rowsHandle));
        buffer = reinterpret_cast<uint8_t*>(node::Buffer::Data(bufferHandle));
  }

  ~EncodeWorker() {}

  void Execute () {
    int targetCount = 0;
    for (int targetIndex = 0; targetIndex < 31; targetIndex++) {
      if (targets & (1 << targetIndex)) {
        const uint8_t* row = rows + (targetCount * rowSize);
        uint8_t* target = buffer + (bufferOffset + (targetIndex * shardLength));
        int sourceCount = 0;
        for (int sourceIndex = 0; sourceIndex < 31; sourceIndex++) {
          if (sources & (1 << sourceIndex)) {
            const uint8_t* table = tables + (row[sourceCount] * 256);
            const uint8_t* source = buffer + (
              bufferOffset + (sourceIndex * shardLength)
            );
            if (sourceCount == 0) {
              mset(table, source, target, shardOffset, shardOffset + shardSize);
            } else {
              mxor(table, source, target, shardOffset, shardOffset + shardSize);
            }
            sourceCount++;
          }
        }
        targetCount++;
      }
    }
  }

 private:
  const uint8_t* tables;
  const uint8_t* rows;
  const uint32_t rowSize;
  uint8_t* buffer;
  const uint32_t bufferOffset;
  const uint32_t shardLength;
  const uint32_t shardOffset;
  const uint32_t shardSize;
  const uint32_t sources;
  const uint32_t targets;
};

unsigned int count_bits(unsigned int bits) {
  // Count the number of bits set.
  unsigned int count;
  for (count = 0; bits; count++) {
    bits &= bits - 1;
  }
  return count;
}

unsigned int index_msb(unsigned int bits) {
  // Find the index of the most significant bit.
  unsigned int index = 31;
  while (index--) {
    if (bits & (1 << index)) return index;
  }
  return -1;
}

NAN_METHOD(encode) {
  if (
    info.Length() != 12 ||
    !node::Buffer::HasInstance(info[0]) ||
    !node::Buffer::HasInstance(info[1]) ||
    !info[2]->IsUint32() ||
    !node::Buffer::HasInstance(info[3]) ||
    !info[4]->IsUint32() ||
    !info[5]->IsUint32() ||
    !info[6]->IsUint32() ||
    !info[7]->IsUint32() ||
    !info[8]->IsUint32() ||
    !info[9]->IsUint32() ||
    !info[10]->IsUint32() ||
    !info[11]->IsFunction()
  ) {
    return Nan::ThrowError(
      "bad arguments, expected: (Buffer tables, Buffer rows, int rowSize, "
      "Buffer buffer, int bufferOffset, int bufferSize, "
      "int shardLength, int shardOffset, int shardSize, "
      "int sources, int targets, function end)"
    );
  }
  v8::Local<v8::Object> tablesHandle = info[0].As<v8::Object>();
  v8::Local<v8::Object> rowsHandle = info[1].As<v8::Object>();
  const uint32_t rowSize = info[2]->Uint32Value();
  v8::Local<v8::Object> bufferHandle = info[3].As<v8::Object>();
  const uint32_t bufferOffset = info[4]->Uint32Value();
  const uint32_t bufferSize = info[5]->Uint32Value();
  const uint32_t shardLength = info[6]->Uint32Value();
  const uint32_t shardOffset = info[7]->Uint32Value();
  const uint32_t shardSize = info[8]->Uint32Value();
  const uint32_t sources = info[9]->Uint32Value();
  const uint32_t targets = info[10]->Uint32Value();
  Nan::Callback *end = new Nan::Callback(info[11].As<v8::Function>());
  if (node::Buffer::Length(tablesHandle) != 65536) {
    return Nan::ThrowError("tables length != 256 x 256");
  }
  if (bufferOffset + bufferSize > node::Buffer::Length(bufferHandle)) {
    return Nan::ThrowError("bufferOffset + bufferSize > buffer.length");
  }
  if (shardLength > 0 && (bufferSize % shardLength) != 0) {
    return Nan::ThrowError("bufferSize must be a multiple of shardLength");
  }
  if (shardLength == 0 && bufferSize != 0) {
    return Nan::ThrowError("shardLength == 0 && bufferSize != 0");
  }
  if (shardOffset + shardSize > shardLength) {
    return Nan::ThrowError("shardOffset + shardSize > shardLength");
  }
  if (sources == 0) {
    return Nan::ThrowError("sources == 0 shards");
  }
  if (targets == 0) {
    return Nan::ThrowError("targets == 0 shards");
  }
  if (sources > 2147483647) {
    return Nan::ThrowError("sources > 31 shards");
  }
  if (targets > 2147483647) {
    return Nan::ThrowError("targets > 31 shards");
  }
  if ((sources & targets) != 0) {
    return Nan::ThrowError("sources cannot be targets");
  }
  if ((index_msb(sources) * shardLength) + shardLength > bufferSize) {
    return Nan::ThrowError("buffer would overflow (too many sources)");
  }
  if ((index_msb(targets) * shardLength) + shardLength > bufferSize) {
    return Nan::ThrowError("buffer would overflow (too many targets)");
  }
  if (node::Buffer::Length(rowsHandle) != count_bits(targets) * rowSize) {
    return Nan::ThrowError("rows length != number of targets * rowSize");
  }
  if (rowSize != count_bits(sources)) {
    return Nan::ThrowError("rowSize != number of sources");
  }
  Nan::AsyncQueueWorker(new EncodeWorker(
    tablesHandle,
    rowsHandle,
    rowSize,
    bufferHandle,
    bufferOffset,
    shardLength,
    shardOffset,
    shardSize,
    sources,
    targets,
    end
  ));
}

NAN_MODULE_INIT(Init) {
  NAN_EXPORT(target, encode);
}

NODE_MODULE(binding, Init)

// S.D.G.

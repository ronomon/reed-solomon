#include <stdint.h>
#include <nan.h>

using namespace Nan;
using namespace v8;

uint8_t* cast_buffer(Local<Object> object) {
  return (uint8_t*) node::Buffer::Data(object);
}

NAN_METHOD(mset) {
  uint8_t* mtable = cast_buffer(info[0]->ToObject());
  uint8_t* source = cast_buffer(info[1]->ToObject());
  uint8_t* target = cast_buffer(info[2]->ToObject());
  uint32_t offset = info[3]->Uint32Value();
  uint32_t length = info[4]->Uint32Value();
  uint32_t blocks = (length - offset) / 16;
  target += offset;
  source += offset;
  while (blocks--) {
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    *target++ = *(mtable + *source++);
    offset += 16;
  }
  while (offset++ < length) {
    *target++ = *(mtable + *source++);
  }
}

NAN_METHOD(mxor) {
  uint8_t* mtable = cast_buffer(info[0]->ToObject());
  uint8_t* source = cast_buffer(info[1]->ToObject());
  uint8_t* target = cast_buffer(info[2]->ToObject());
  uint32_t offset = info[3]->Uint32Value();
  uint32_t length = info[4]->Uint32Value();
  uint32_t blocks = (length - offset) / 16;
  target += offset;
  source += offset;
  while (blocks--) {
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    *target++ ^= *(mtable + *source++);
    offset += 16;
  }
  while (offset++ < length) {
    *target++ ^= *(mtable + *source++);
  }
}

NAN_MODULE_INIT(Init) {
  Nan::Set(
    target,
    New<String>("mset").ToLocalChecked(),
    GetFunction(New<FunctionTemplate>(mset)).ToLocalChecked()
  );
  Nan::Set(
    target,
    New<String>("mxor").ToLocalChecked(),
    GetFunction(New<FunctionTemplate>(mxor)).ToLocalChecked()
  );
}

NODE_MODULE(binding, Init)

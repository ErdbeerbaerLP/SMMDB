#pragma once
#include <vector>
#include <cstdint>

class Ash
{
public:
	static bool isAshCompressed(std::vector<uint8_t>& in);
	static std::vector<uint8_t> decompress(std::vector<uint8_t>& in);
};

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>  // for size_t
#include <stdint.h>  // for uint8_t

// The decompress function wrapper:
//   - input: a pointer to input data and its size
//   - output: a pointer to a variable that will receive the size of the decompressed data
//   - returns: a pointer to a new allocated buffer containing decompressed data
uint8_t* ash_decompress(const uint8_t* input, size_t input_size, size_t* output_size);

// (Optional) Free function for buffers allocated by ash_decompress.
void ash_free(uint8_t* buffer);

#ifdef __cplusplus
}
#endif

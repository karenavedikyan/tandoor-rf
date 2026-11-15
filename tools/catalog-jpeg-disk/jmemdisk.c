/*
 * Bounded disk backing-store adapter for libjpeg-turbo's virtual coefficient
 * arrays. Implements the public internal jmemsys.h contract; no codec changes.
 * This file is original project code. Upstream libjpeg-turbo retains its own
 * BSD/IJG/zlib licenses, distributed with the pinned source archive.
 */
#define JPEG_INTERNALS
#include "jinclude.h"
#include "jpeglib.h"
#include "jmemsys.h"
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdint.h>

#define MAX_BACKING (256UL * 1024 * 1024)
#define IO_CHUNK (16UL * 1024 * 1024)
static size_t backing_total = 0;

GLOBAL(void *) jpeg_get_small(j_common_ptr cinfo, size_t n)
{ (void)cinfo; return malloc(n); }
GLOBAL(void) jpeg_free_small(j_common_ptr cinfo, void *p, size_t n)
{ (void)cinfo; (void)n; free(p); }
GLOBAL(void *) jpeg_get_large(j_common_ptr cinfo, size_t n)
{ (void)cinfo; return malloc(n); }
GLOBAL(void) jpeg_free_large(j_common_ptr cinfo, void *p, size_t n)
{ (void)cinfo; (void)n; free(p); }

GLOBAL(size_t) jpeg_mem_available(j_common_ptr cinfo, size_t min_needed,
                                 size_t max_needed, size_t allocated)
{
  size_t limit = cinfo->mem->max_memory_to_use > 0 ?
    (size_t)cinfo->mem->max_memory_to_use : 0;
  (void)min_needed; (void)max_needed;
  /* Also cap callers that forget the command-line -maxmemory setting. */
  if (limit > 64UL * 1024 * 1024) limit = 64UL * 1024 * 1024;
  return allocated < limit ? limit - allocated : 0;
}

static void transfer(j_common_ptr cinfo, backing_store_ptr info,
                     void *buffer, long offset, long count, int writing)
{
  size_t capacity = (size_t)strtoull(info->temp_name, NULL, 10);
  unsigned char *p = buffer;
  int fd = fileno(info->temp_file);
  if (offset < 0 || count < 0 || (size_t)offset > capacity ||
      (size_t)count > capacity - (size_t)offset) ERREXIT(cinfo, JERR_TFILE_SEEK);
  while (count > 0) {
    size_t wanted = (size_t)count > IO_CHUNK ? IO_CHUNK : (size_t)count;
    ssize_t result;
    do {
      result = writing ? pwrite(fd, p, wanted, (off_t)offset) :
                         pread(fd, p, wanted, (off_t)offset);
    } while (result < 0 && errno == EINTR);
    if (result <= 0) ERREXIT(cinfo, writing ? JERR_TFILE_WRITE : JERR_TFILE_READ);
    /* Do not replace anonymous RSS pressure with unreclaimable dirty cache.
     * At most one 16 MiB write is pending before sync. Keep the now-clean
     * cache reclaimable by Linux: evicting it after every progressive scan
     * would force needless repeated physical reads of the same coefficients. */
    if (writing && fdatasync(fd) != 0) ERREXIT(cinfo, JERR_TFILE_WRITE);
    offset += result; count -= result; p += result;
  }
}
static void read_store(j_common_ptr c, backing_store_ptr i, void *b, long o, long n)
{ transfer(c, i, b, o, n, 0); }
static void write_store(j_common_ptr c, backing_store_ptr i, void *b, long o, long n)
{ transfer(c, i, b, o, n, 1); }
static void close_store(j_common_ptr cinfo, backing_store_ptr info)
{
  size_t bytes = (size_t)strtoull(info->temp_name, NULL, 10);
  (void)cinfo;
  fclose(info->temp_file); info->temp_file = NULL;
  backing_total = bytes <= backing_total ? backing_total - bytes : 0;
}
GLOBAL(void) jpeg_open_backing_store(j_common_ptr cinfo, backing_store_ptr info, long needed)
{
  const char *directory = getenv("TMPDIR");
  char filename[4096];
  int fd, length;
  if (!directory || directory[0] != '/' || needed <= 0 ||
      (size_t)needed > MAX_BACKING - backing_total) ERREXIT(cinfo, JERR_NO_BACKING_STORE);
  length = snprintf(filename, sizeof(filename), "%s/jpeg-coeff-XXXXXX", directory);
  if (length < 0 || (size_t)length >= sizeof(filename)) ERREXIT(cinfo, JERR_NO_BACKING_STORE);
  fd = mkstemp(filename);
  if (fd < 0) ERREXITS(cinfo, JERR_TFILE_CREATE, "");
  /* Unlink immediately: success, decode errors and SIGKILL all release storage.
   * No source paths, credentials or image bytes are exposed by a filename. */
  if (unlink(filename) != 0) { close(fd); ERREXIT(cinfo, JERR_TFILE_WRITE); }
  info->temp_file = fdopen(fd, "w+b");
  if (!info->temp_file) { close(fd); ERREXIT(cinfo, JERR_TFILE_WRITE); }
  if (ftruncate(fd, (off_t)needed) != 0) {
    fclose(info->temp_file); info->temp_file = NULL; ERREXIT(cinfo, JERR_TFILE_WRITE);
  }
  snprintf(info->temp_name, sizeof(info->temp_name), "%lu", (unsigned long)needed);
  info->read_backing_store = read_store; info->write_backing_store = write_store;
  info->close_backing_store = close_store;
  backing_total += (size_t)needed;
}
GLOBAL(long) jpeg_mem_init(j_common_ptr cinfo)
{ (void)cinfo; return 64L * 1024 * 1024; }
GLOBAL(void) jpeg_mem_term(j_common_ptr cinfo)
{ (void)cinfo; }

/**
 * OpenGL Overlay Renderer
 *
 * Reads BGRA pixels from shared memory, uploads to a GL texture,
 * and draws a fullscreen alpha-blended quad using legacy fixed-function
 * pipeline (maximises compatibility with older GL games).
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <GL/gl.h>
#include <cstdio>
#include <cstring>

#include "overlay_protocol.h"

namespace uc_shmem { const UCFrameHeader* header(); const uint8_t* pixels(); }

/* GL_BGRA is in glext.h but we avoid that dependency */
#ifndef GL_BGRA
#define GL_BGRA 0x80E1
#endif

namespace uc_gl_renderer {

static GLuint   g_tex     = 0;
static uint32_t g_texW    = 0;
static uint32_t g_texH    = 0;
static uint32_t g_lastSeq = 0;

bool init(uint32_t w, uint32_t h) {
    g_texW = w;
    g_texH = h;

    glGenTextures(1, &g_tex);
    glBindTexture(GL_TEXTURE_2D, g_tex);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP);
    // Allocate
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, g_texW, g_texH, 0,
                 GL_BGRA, GL_UNSIGNED_BYTE, nullptr);
    glBindTexture(GL_TEXTURE_2D, 0);

    OutputDebugStringA("[UC-GL] Renderer initialized.\n");
    return true;
}

void render() {
    const auto* hdr = uc_shmem::header();
    if (!hdr || !hdr->visible) return;
    const uint8_t* px = uc_shmem::pixels();
    if (!px || !g_tex) return;

    // Upload on sequence change
    if (hdr->seq != g_lastSeq) {
        glBindTexture(GL_TEXTURE_2D, g_tex);
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, g_texW, g_texH,
                        GL_BGRA, GL_UNSIGNED_BYTE, px);
        glBindTexture(GL_TEXTURE_2D, 0);
        g_lastSeq = hdr->seq;
    }

    // Save state
    glPushAttrib(GL_ALL_ATTRIB_BITS);
    glPushMatrix();

    // Setup orthographic projection covering the viewport
    GLint viewport[4];
    glGetIntegerv(GL_VIEWPORT, viewport);
    float vw = (float)viewport[2];
    float vh = (float)viewport[3];

    glMatrixMode(GL_PROJECTION);
    glPushMatrix();
    glLoadIdentity();
    glOrtho(0, vw, vh, 0, -1, 1); // top-left origin

    glMatrixMode(GL_MODELVIEW);
    glPushMatrix();
    glLoadIdentity();

    // Render state
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_LIGHTING);
    glDisable(GL_CULL_FACE);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glEnable(GL_TEXTURE_2D);
    glBindTexture(GL_TEXTURE_2D, g_tex);

    glColor4f(1, 1, 1, 1);
    glBegin(GL_TRIANGLE_STRIP);
        glTexCoord2f(0, 0); glVertex2f(0,  0);
        glTexCoord2f(1, 0); glVertex2f(vw, 0);
        glTexCoord2f(0, 1); glVertex2f(0,  vh);
        glTexCoord2f(1, 1); glVertex2f(vw, vh);
    glEnd();

    // Restore state
    glMatrixMode(GL_MODELVIEW);
    glPopMatrix();
    glMatrixMode(GL_PROJECTION);
    glPopMatrix();

    glPopMatrix();
    glPopAttrib();
}

void cleanup() {
    if (g_tex) { glDeleteTextures(1, &g_tex); g_tex = 0; }
    g_texW = g_texH = g_lastSeq = 0;
}

} // namespace uc_gl_renderer

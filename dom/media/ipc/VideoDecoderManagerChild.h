/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=99: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#ifndef include_dom_ipc_VideoDecoderManagerChild_h
#define include_dom_ipc_VideoDecoderManagerChild_h

#include "mozilla/RefPtr.h"
#include "mozilla/dom/PVideoDecoderManagerChild.h"

namespace mozilla {
namespace gfx {
class SourceSurface;
}
namespace dom {

class VideoDecoderManagerChild final : public PVideoDecoderManagerChild
                                     , public mozilla::ipc::IShmemAllocator
{
public:
  NS_INLINE_DECL_THREADSAFE_REFCOUNTING(VideoDecoderManagerChild)

  // Can only be called from the manager thread
  static VideoDecoderManagerChild* GetSingleton();

  // Can be called from any thread.
  static nsIThread* GetManagerThread();
  static AbstractThread* GetManagerAbstractThread();

  // Can be called from any thread, dispatches the request to the IPDL thread internally
  // and will be ignored if the IPDL actor has been destroyed.
  already_AddRefed<gfx::SourceSurface> Readback(const SurfaceDescriptorGPUVideo& aSD);
  void DeallocateSurfaceDescriptorGPUVideo(const SurfaceDescriptorGPUVideo& aSD);

  bool AllocShmem(size_t aSize,
                  mozilla::ipc::SharedMemory::SharedMemoryType aShmType,
                  mozilla::ipc::Shmem* aShmem) override
  {
    return PVideoDecoderManagerChild::AllocShmem(aSize, aShmType, aShmem);
  }
  bool AllocUnsafeShmem(size_t aSize,
                        mozilla::ipc::SharedMemory::SharedMemoryType aShmType,
                        mozilla::ipc::Shmem* aShmem) override
  {
    return PVideoDecoderManagerChild::AllocUnsafeShmem(aSize, aShmType, aShmem);
  }

  // Can be called from any thread, dispatches the request to the IPDL thread internally
  // and will be ignored if the IPDL actor has been destroyed.
  bool DeallocShmem(mozilla::ipc::Shmem& aShmem) override;

  // Main thread only
  static void Initialize();
  static void Shutdown();

protected:
  void ActorDestroy(ActorDestroyReason aWhy) override;
  void DeallocPVideoDecoderManagerChild() override;

  void FatalError(const char* const aName, const char* const aMsg) const override;

  PVideoDecoderChild* AllocPVideoDecoderChild() override;
  bool DeallocPVideoDecoderChild(PVideoDecoderChild* actor) override;

private:
  VideoDecoderManagerChild()
    : mCanSend(false)
  {}
  ~VideoDecoderManagerChild() {}

  void Open(Endpoint<PVideoDecoderManagerChild>&& aEndpoint);

  // Should only ever be accessed on the manager thread.
  bool mCanSend;
};

} // namespace dom
} // namespace mozilla

#endif // include_dom_ipc_VideoDecoderManagerChild_h

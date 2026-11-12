#!/usr/bin/env ruby
# ALL-243: exercise real xcodeproj behavior on Ubuntu without Xcode, signing,
# paid build minutes, Apple certificates, or user hardware.
require 'xcodeproj'
require 'fileutils'
require 'pathname'

root = File.expand_path('..', __dir__)
ios_dir = File.join(root, 'apps', 'mobile-v2', 'ios')
abort 'Refuse to replace an existing native iOS project' if File.exist?(ios_dir)
fixture_project_path = File.join(ios_dir, 'AllInV2Fixture.xcodeproj')
bundle_id = 'com.example.allin365fixture'
begin
  FileUtils.mkdir_p(ios_dir)
  project = Xcodeproj::Project.new(fixture_project_path)
  iphone = project.new_target(:application, 'AllInV2Fixture', :ios, '16.0')
  iphone.build_configurations.each do |config|
    config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = bundle_id
  end
  project.save

  2.times do |pass|
    environment = {'ALLIN_V2_IOS_BUNDLE_ID' => bundle_id}
    ok = system(environment, 'ruby',
      File.join(root, 'scripts', 'integrate-apple-watch-target.rb'),
      out: File::NULL)
    abort "ALL-243 generator pass #{pass + 1} failed" unless ok
  end

  generated = Xcodeproj::Project.open(fixture_project_path)
  phone = generated.targets.find { |target| target.name == 'AllInV2Fixture' }
  watch_targets = generated.targets.select { |target| target.name == 'ALLIN365Watch' }
  abort 'Expected one iPhone and one Watch target' unless phone && watch_targets.length == 1
  watch = watch_targets.fetch(0)
  abort 'Watch target must be modern single-target watchOS application' unless
    watch.product_type == 'com.apple.product-type.application'
  abort 'Missing iPhone-to-watch dependency' unless
    phone.dependencies.count { |dep| dep.target == watch } == 1
  embed = phone.build_phases.select do |phase|
    phase.is_a?(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase) &&
      phase.name == 'Embed Watch Content'
  end
  abort 'Expected exactly one Embed Watch Content phase' unless embed.length == 1
  phase = embed.fetch(0)
  abort 'Modern Watch target must embed into PlugIns' unless
    phase.dst_subfolder_spec == '13' && phase.dst_path == ''
  abort 'Embedded Watch product reference duplicated' unless
    phase.files_references.count { |ref| ref == watch.product_reference } == 1

  watch_sources = watch.source_build_phase.files_references.map(&:path)
  phone_sources = phone.source_build_phase.files_references.map(&:path)
  %w[ALLIN365WatchApp.swift WatchPairingChallengeSigner.swift].each do |name|
    abort "Missing compiled watch source #{name}" unless watch_sources.count(name) == 1
  end
  %w[IPhoneWatchPairingCoordinator.swift IPhoneAppAttestEnrollment.swift
     ALLINWatchPairingModule.swift ALLINWatchPairingModule.m].each do |name|
    abort "Missing compiled iPhone source #{name}" unless phone_sources.count(name) == 1
  end
  watch.build_configurations.each do |config|
    abort 'Incorrect Watch bundle ID' unless
      config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] == "#{bundle_id}.watchkitapp"
    abort 'Watch target deployment below approved minimum' unless
      config.build_settings['WATCHOS_DEPLOYMENT_TARGET'] == '10.0'
  end
  puts 'PASS ALL-243 generated modern Watch target, embedded PlugIn, both source groups and repeat-run idempotence'
ensure
  # Only created by this fixture, never remove a user/project native checkout.
  FileUtils.rm_rf(ios_dir)
end
